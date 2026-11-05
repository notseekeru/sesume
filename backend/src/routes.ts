import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { pool } from "./db.js";
import * as latex from "./latex.js";
import { configFrom, isStub, reviewResume, rewriteLine } from "./llm.js";
import { ExtractError, extractPdf, LIMITS, sanitize } from "./resumes.js";
import { claim, LINE_MAX, MAX_REWRITES, quotedBy, type ReviewBody, readsAt, sourceHash, validReview } from "./review.js";

const RESUME_COLS = "id::text, name, page_count, created_at, updated_at, length(text) AS chars";
const RESUME_COLS_WITH_TEXT = `${RESUME_COLS}, text`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Problem extends Error {
    constructor(
        readonly status: ContentfulStatusCode,
        message: string,
    ) {
        super(message);
    }
}

type Row = Record<string, unknown>;

const sql = (text: string, values: unknown[] = []) => pool.query(text, values);

async function rows(text: string, values: unknown[] = []): Promise<Row[]> {
    return (await sql(text, values)).rows as Row[];
}

async function one(text: string, values: unknown[] = []): Promise<Row | null> {
    return ((await sql(text, values)).rows as Row[])[0] ?? null;
}

async function body<T>(c: Context): Promise<T> {
    try {
        return (await c.req.json()) as T;
    } catch {
        throw new Problem(422, "That request body is not valid JSON.");
    }
}

function resumeName(raw: unknown, fallback = "Untitled resume"): string {
    const stem = (typeof raw === "string" ? raw : "").replaceAll("\\", "/").split("/").pop() ?? "";
    const bare = stem.toLowerCase().endsWith(".pdf") ? stem.slice(0, -4) : stem;
    return sanitize(bare, 80).trim() || fallback;
}

function resumeBody(text: unknown): string {
    const saved = typeof text === "string" ? sanitize(text, LIMITS.chars) : "";
    if (!saved) throw new Problem(422, "There is no text to save. Paste some, or upload a PDF with selectable text.");
    return saved;
}

function reviewJson(review: unknown, createdAt: unknown, fresh: boolean, status: ContentfulStatusCode = 200): Response {
    const parsed = validReview(review);
    if (parsed === null) throw new Problem(500, "Something went wrong.");
    return Response.json({ ...parsed, created_at: createdAt, stale: !fresh, reads_at: readsAt(parsed.levels.map((level) => [level.level, level.call])) }, { status });
}

const routes = new Hono();

routes.onError((error, c) => {
    if (error instanceof Problem) return c.json({ detail: error.message }, error.status);
    console.error("route.error", error);
    return c.json({ detail: "Something went wrong." }, 500);
});

routes.get("/resumes", async (c) => c.json(await rows(`SELECT ${RESUME_COLS} FROM resumes ORDER BY created_at DESC`)));

routes.get("/resumes/:id", async (c) => {
    const id = c.req.param("id");
    const found = UUID.test(id) ? await one(`SELECT ${RESUME_COLS_WITH_TEXT} FROM resumes WHERE id = $1`, [id]) : null;
    if (found === null) throw new Problem(404, "Resume not found");
    return c.json(found);
});

routes.post("/resumes/extract", async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    const limit = (LIMITS.bytes / (1024 * 1024)).toString();
    if (declared > LIMITS.bytes + 64 * 1024) throw new Problem(413, `That file is larger than ${limit} MB. Trim it down, or paste the text instead.`);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new Problem(422, "That file isn't a PDF. Upload a PDF, or paste the text instead.");
    if (file.size > LIMITS.bytes) throw new Problem(413, `That file is larger than ${limit} MB. Trim it down, or paste the text instead.`);
    try {
        const got = await extractPdf(new Uint8Array(await file.arrayBuffer()));
        return c.json({ text: got.text, pages: got.pages, truncated: got.truncated });
    } catch (error) {
        if (error instanceof ExtractError) throw new Problem(422, error.message);
        throw error;
    }
});

routes.post("/resumes", async (c) => {
    const input = await body<{ name?: unknown; text?: unknown }>(c);
    const saved = await one(`INSERT INTO resumes (name, text) VALUES ($1, $2) RETURNING ${RESUME_COLS_WITH_TEXT}`, [resumeName(input.name), resumeBody(input.text)]);
    return c.json(saved, 201);
});

routes.put("/resumes/:id", async (c) => {
    const id = c.req.param("id");
    const input = await body<{ name?: unknown; text?: unknown }>(c);
    const saved = UUID.test(id) ? await one(`UPDATE resumes SET name = $2, text = $3, updated_at = now() WHERE id = $1 RETURNING ${RESUME_COLS_WITH_TEXT}`, [id, resumeName(input.name), resumeBody(input.text)]) : null;
    if (saved === null) throw new Problem(404, "Resume not found");
    return c.json(saved);
});

routes.delete("/resumes/:id", async (c) => {
    const id = c.req.param("id");
    const gone = UUID.test(id) ? await one("DELETE FROM resumes WHERE id = $1 RETURNING id", [id]) : null;
    if (gone === null) throw new Problem(404, "Resume not found");
    return c.body(null, 204);
});

routes.get("/resumes/:id/review", async (c) => {
    const id = c.req.param("id");
    const found = UUID.test(id)
        ? await one(
              `SELECT rr.review, rr.created_at, rr.source_hash = encode(sha256(convert_to(r.text, 'UTF8')), 'hex') AS fresh
               FROM resume_reviews rr JOIN resumes r ON r.id = rr.resume_id
               WHERE rr.resume_id = $1`,
              [id],
          )
        : null;
    if (found === null) return c.json(null);
    return reviewJson(found.review, found.created_at, Boolean(found.fresh));
});

routes.post("/resumes/:id/review", async (c) => {
    const id = c.req.param("id");
    const found = UUID.test(id) ? await one("SELECT text FROM resumes WHERE id = $1", [id]) : null;
    if (found === null) throw new Problem(404, "Resume not found");
    const text = String(found.text);
    const config = configFrom(c.req.raw.headers);
    if (isStub(config)) throw new Problem(503, "No scoring engine is configured on this deployment, so a review cannot run.");
    const got = await reviewResume(text, config);
    if (got === null) throw new Problem(503, "The reviewer could not read this resume right now. Try again in a moment.");
    const saved = await one("INSERT INTO resume_reviews (resume_id, source_hash, review) VALUES ($1, $2, $3) ON CONFLICT (resume_id) DO UPDATE SET source_hash = EXCLUDED.source_hash, review = EXCLUDED.review, created_at = now() RETURNING review, created_at", [id, sourceHash(text), got]);
    return reviewJson(saved?.review, saved?.created_at, true, 201);
});

routes.post("/resumes/:id/review/rewrite", async (c) => {
    const id = c.req.param("id");
    const input = await body<{ source?: unknown }>(c);
    const found = UUID.test(id)
        ? await one(
              `SELECT r.text, rr.review
               FROM resumes r
               LEFT JOIN resume_reviews rr ON rr.resume_id = r.id AND rr.source_hash = encode(sha256(convert_to(r.text, 'UTF8')), 'hex')
               WHERE r.id = $1`,
              [id],
          )
        : null;
    if (found === null) throw new Problem(404, "Resume not found");
    const text = String(found.text);
    const source = claim(input.source, LINE_MAX);
    if (!source || !quotedBy(text, source)) throw new Problem(422, "That line is not on this resume any more. Re-review it and try again.");
    if (found.review === null) throw new Problem(409, "Review this resume first: there is no edit to retry.");
    const current = validReview(found.review);
    if (current === null) throw new Problem(409, "Review this resume first: there is no edit to retry.");
    const config = configFrom(c.req.raw.headers);
    if (isStub(config)) throw new Problem(503, "No scoring engine is configured on this deployment, so an edit cannot be retried.");
    const got = await rewriteLine(text, source, config);
    if (got === null) throw new Problem(503, "The reviewer could not write a different line right now. Try again in a moment.");
    const stored: ReviewBody = { ...current, rewrites: [{ source, rewrite: got }, ...current.rewrites.filter((item) => item.source !== source)].slice(0, MAX_REWRITES) };
    const saved = await one("UPDATE resume_reviews SET review = $2 WHERE resume_id = $1 RETURNING review, created_at", [id, stored]);
    return reviewJson(saved?.review, saved?.created_at, true);
});

routes.post("/resumes/preview", async (c) => {
    const input = await body<{ text?: unknown }>(c);
    const text = typeof input.text === "string" ? input.text : "";
    if (!text.includes("\\documentclass")) throw new Problem(422, "That is not a LaTeX document: it needs a \\documentclass line.");
    if (text.length > LIMITS.chars) throw new Problem(422, "That document is too long to compile.");
    if (!latex.available()) throw new Problem(503, "No LaTeX engine is installed on this deployment.");
    try {
        const pdf = await latex.compilePdf(text);
        return c.body(pdf, 200, { "content-type": "application/pdf", "cache-control": "no-store" });
    } catch (error) {
        if (error instanceof latex.CompileBusy) return c.json({ detail: "The preview is busy. Try again in a moment." }, 503, { "retry-after": "5" });
        if (error instanceof latex.CompileError) throw new Problem(422, error.message);
        throw error;
    }
});

export default routes;
