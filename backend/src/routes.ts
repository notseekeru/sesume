import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DatabaseError } from "pg";
import { clear, guard, hashPassword, issue, type Session, verifyPassword } from "./auth.js";
import { open, seal } from "./crypto.js";
import { pool } from "./db.js";
import * as latex from "./latex.js";
import { configFrom, isStub, reviewResume, rewriteLine } from "./llm.js";
import { limit } from "./rate.js";
import { ExtractError, extractPdf, LIMITS, sanitize, TOO_LARGE } from "./resumes.js";
import { claim, LINE_MAX, MAX_REWRITES, quotedBy, type ReviewBody, readsAt, sourceHash, validReview } from "./review.js";

const RESUME_COLS = "id::text, name, created_at, updated_at";
const RESUME_COLS_WITH_TEXT = `${RESUME_COLS}, text`;
const RESUME_CAP = 50;
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
    const saved = typeof text === "string" ? sanitize(text, LIMITS.chars + 1) : "";
    if (!saved) throw new Problem(422, "There is no text to save. Paste some, or upload a PDF with selectable text.");
    if ([...saved].length > LIMITS.chars) throw new Problem(422, "That resume is longer than this deployment stores.");
    return saved;
}

const textAad = (id: string) => `resumes.text:${id}`;
const reviewAad = (id: string) => `resume_reviews.review:${id}`;
const providerAad = (id: string, field: string) => `provider_configs.${field}:${id}`;
const PROVIDER_CAP = { baseUrl: 500, model: 200, key: 500 };

function cut(value: unknown, max: number): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function storedProvider(userId: string): Promise<Row | null> {
    return one("SELECT base_url, model, api_key FROM provider_configs WHERE user_id = $1", [userId]);
}

async function providerHeaders(userId: string, headers: Headers): Promise<Headers> {
    const row = await storedProvider(userId);
    if (row === null) return headers;
    const out = new Headers(headers);
    out.set("x-llm-base-url", open(String(row.base_url), providerAad(userId, "base_url")));
    out.set("x-llm-model", open(String(row.model), providerAad(userId, "model")));
    out.set("x-llm-key", open(String(row.api_key), providerAad(userId, "api_key")));
    return out;
}

function readReview(value: unknown, id: string): unknown {
    try {
        return JSON.parse(open(String(value ?? ""), reviewAad(id)));
    } catch {
        return null;
    }
}

function reviewJson(review: unknown, createdAt: unknown, fresh: boolean, status: ContentfulStatusCode = 200): Response {
    const parsed = validReview(review);
    if (parsed === null) throw new Problem(500, "Something went wrong.");
    return Response.json({ ...parsed, created_at: createdAt, stale: !fresh, reads_at: readsAt(parsed.levels.map((level) => [level.level, level.call])) }, { status });
}

const routes = new Hono<Session>();

routes.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    console.info(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)}ms`);
});
routes.use("*", limit);

const jsonLimit = bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ detail: "That request is too large." }, 413) });
const uploadLimit = bodyLimit({ maxSize: LIMITS.bytes + 64 * 1024, onError: (c) => c.json({ detail: TOO_LARGE }, 413) });

routes.onError((error, c) => {
    if (error instanceof Problem) return c.json({ detail: error.message }, error.status);
    if (error instanceof DatabaseError && ["23514", "22001", "22003"].includes(error.code ?? "")) return c.json({ detail: "That resume does not fit what this deployment stores." }, 422);
    console.error("route.error", error);
    return c.json({ detail: "Something went wrong." }, 500);
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY = hashPassword("sesume-dummy-password");

function emailOf(raw: unknown): string {
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) throw new Problem(422, "Enter a valid email address.");
    return email;
}

function passwordOf(raw: unknown): string {
    const password = typeof raw === "string" ? raw : "";
    if (password.length < 8 || password.length > 200) throw new Problem(422, "A password needs 8 to 200 characters.");
    return password;
}

function adoptOrphans(userId: string) {
    return sql("UPDATE resumes SET user_id = $1 WHERE user_id IS NULL AND $1::uuid = (SELECT id FROM users ORDER BY created_at, id LIMIT 1)", [userId]);
}

routes.post("/auth/register", jsonLimit, async (c) => {
    const input = await body<{ email?: unknown; password?: unknown }>(c);
    const email = emailOf(input.email);
    const hashed = await hashPassword(passwordOf(input.password));
    const user = await one("INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id::text", [email, hashed]);
    if (user === null) throw new Problem(409, "That email already has an account.");
    await adoptOrphans(String(user.id));
    issue(c, String(user.id));
    return c.json({ email }, 201);
});

routes.post("/auth/login", jsonLimit, async (c) => {
    const input = await body<{ email?: unknown; password?: unknown }>(c);
    const email = emailOf(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    if (!password) throw new Problem(422, "Enter your email and password.");
    const user = await one("SELECT id::text, password_hash FROM users WHERE email = $1", [email]);
    const matched = await verifyPassword(password, user === null ? await DUMMY : String(user.password_hash));
    if (user === null || !matched) throw new Problem(401, "That email and password do not match.");
    await adoptOrphans(String(user.id));
    issue(c, String(user.id));
    return c.json({ email });
});

routes.post("/auth/logout", (c) => {
    clear(c);
    return c.body(null, 204);
});

routes.get("/auth/me", guard, async (c) => {
    const found = await one("SELECT email FROM users WHERE id = $1", [c.get("user").id]);
    if (found === null) throw new Problem(401, "An account is required.");
    return c.json({ email: found.email });
});

routes.get("/resumes", guard, async (c) => c.json(await rows(`SELECT ${RESUME_COLS} FROM resumes WHERE user_id = $1 ORDER BY created_at DESC`, [c.get("user").id])));

routes.get("/provider", guard, async (c) => {
    const userId = c.get("user").id;
    const row = await storedProvider(userId);
    if (row === null) return c.json({ baseUrl: "", model: "", hasKey: false });
    return c.json({
        baseUrl: open(String(row.base_url), providerAad(userId, "base_url")),
        model: open(String(row.model), providerAad(userId, "model")),
        hasKey: open(String(row.api_key), providerAad(userId, "api_key")) !== "",
    });
});

routes.put("/provider", guard, jsonLimit, async (c) => {
    const userId = c.get("user").id;
    const input = await body<{ baseUrl?: unknown; model?: unknown; key?: unknown }>(c);
    const baseUrl = cut(input.baseUrl, PROVIDER_CAP.baseUrl);
    const model = cut(input.model, PROVIDER_CAP.model);
    const key = cut(input.key, PROVIDER_CAP.key);
    const existing = await storedProvider(userId);
    const sealed = key ? seal(key, providerAad(userId, "api_key")) : existing === null ? "" : String(existing.api_key);
    await one(
        `INSERT INTO provider_configs (user_id, base_url, model, api_key) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET base_url = EXCLUDED.base_url, model = EXCLUDED.model, api_key = EXCLUDED.api_key, updated_at = now()
         RETURNING user_id`,
        [userId, seal(baseUrl, providerAad(userId, "base_url")), seal(model, providerAad(userId, "model")), sealed],
    );
    return c.json({ baseUrl, model, hasKey: sealed !== "" });
});

routes.delete("/provider", guard, async (c) => {
    await sql("DELETE FROM provider_configs WHERE user_id = $1", [c.get("user").id]);
    return c.body(null, 204);
});

routes.get("/resumes/:id", guard, async (c) => {
    const id = c.req.param("id");
    const found = UUID.test(id) ? await one(`SELECT ${RESUME_COLS_WITH_TEXT} FROM resumes WHERE id = $1 AND user_id = $2`, [id, c.get("user").id]) : null;
    if (found === null) throw new Problem(404, "Resume not found");
    return c.json({ ...found, text: open(String(found.text), textAad(id)) });
});

routes.post("/resumes/extract", uploadLimit, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new Problem(422, "Attach a PDF in the file field.");
    if (file.size > LIMITS.bytes) throw new Problem(413, TOO_LARGE);
    try {
        const got = await extractPdf(new Uint8Array(await file.arrayBuffer()));
        return c.json({ text: got.text, pages: got.pages, truncated: got.truncated });
    } catch (error) {
        if (error instanceof ExtractError) throw new Problem(422, error.message);
        throw error;
    }
});

routes.post("/resumes", guard, jsonLimit, async (c) => {
    const input = await body<{ name?: unknown; text?: unknown }>(c);
    const id = randomUUID();
    const text = resumeBody(input.text);
    const saved = await one(
        `INSERT INTO resumes (id, name, text, user_id)
SELECT $1, $2, $3, $4 WHERE (SELECT count(*) FROM resumes WHERE user_id = $4) < ${RESUME_CAP}
RETURNING ${RESUME_COLS_WITH_TEXT}`,
        [id, resumeName(input.name), seal(text, textAad(id)), c.get("user").id],
    );
    if (saved === null) throw new Problem(409, `You have ${RESUME_CAP} resumes. Delete one to make room.`);
    return c.json({ ...saved, text }, 201);
});

routes.put("/resumes/:id", guard, jsonLimit, async (c) => {
    const id = c.req.param("id");
    const input = await body<{ name?: unknown; text?: unknown }>(c);
    const saved = UUID.test(id) ? await one(`UPDATE resumes SET name = $2, text = $3, updated_at = now() WHERE id = $1 AND user_id = $4 RETURNING ${RESUME_COLS_WITH_TEXT}`, [id, resumeName(input.name), seal(resumeBody(input.text), textAad(id)), c.get("user").id]) : null;
    if (saved === null) throw new Problem(404, "Resume not found");
    return c.json({ ...saved, text: open(String(saved.text), textAad(id)) });
});

routes.delete("/resumes/:id", guard, async (c) => {
    const id = c.req.param("id");
    const gone = UUID.test(id) ? await one("DELETE FROM resumes WHERE id = $1 AND user_id = $2 RETURNING id", [id, c.get("user").id]) : null;
    if (gone === null) throw new Problem(404, "Resume not found");
    return c.body(null, 204);
});

routes.get("/resumes/:id/review", guard, async (c) => {
    const id = c.req.param("id");
    const found = UUID.test(id)
        ? await one(
              `SELECT rr.review, rr.source_hash, rr.created_at, r.text
               FROM resume_reviews rr JOIN resumes r ON r.id = rr.resume_id
               WHERE rr.resume_id = $1 AND r.user_id = $2`,
              [id, c.get("user").id],
          )
        : null;
    if (found === null) return c.json(null);
    const fresh = found.source_hash === sourceHash(open(String(found.text), textAad(id)));
    return reviewJson(readReview(found.review, id), found.created_at, fresh);
});

routes.post("/resumes/:id/review", guard, async (c) => {
    const id = c.req.param("id");
    const found = UUID.test(id) ? await one("SELECT text FROM resumes WHERE id = $1 AND user_id = $2", [id, c.get("user").id]) : null;
    if (found === null) throw new Problem(404, "Resume not found");
    const text = open(String(found.text), textAad(id));
    const config = configFrom(await providerHeaders(c.get("user").id, c.req.raw.headers));
    if (isStub(config)) throw new Problem(503, "No scoring engine is configured on this deployment, so a review cannot run.");
    const got = await reviewResume(text, config);
    if (got === null) throw new Problem(503, "The reviewer could not read this resume right now. Try again in a moment.");
    const saved = await one("INSERT INTO resume_reviews (resume_id, source_hash, review) VALUES ($1, $2, $3) ON CONFLICT (resume_id) DO UPDATE SET source_hash = EXCLUDED.source_hash, review = EXCLUDED.review, created_at = now() RETURNING review, created_at", [
        id,
        sourceHash(text),
        seal(JSON.stringify(got), reviewAad(id)),
    ]);
    return reviewJson(readReview(saved?.review, id), saved?.created_at, true, 201);
});

routes.post("/resumes/:id/review/rewrite", guard, jsonLimit, async (c) => {
    const id = c.req.param("id");
    const input = await body<{ source?: unknown }>(c);
    const found = UUID.test(id)
        ? await one(
              `SELECT r.text, rr.review, rr.source_hash
               FROM resumes r
               LEFT JOIN resume_reviews rr ON rr.resume_id = r.id
               WHERE r.id = $1 AND r.user_id = $2`,
              [id, c.get("user").id],
          )
        : null;
    if (found === null) throw new Problem(404, "Resume not found");
    const text = open(String(found.text), textAad(id));
    const source = claim(input.source, LINE_MAX);
    if (!source || !quotedBy(text, source)) throw new Problem(422, "That line is not on this resume any more. Re-review it and try again.");
    const current = found.review === null || found.source_hash !== sourceHash(text) ? null : validReview(readReview(found.review, id));
    if (current === null) throw new Problem(409, "Review this resume first: there is no edit to retry.");
    const config = configFrom(await providerHeaders(c.get("user").id, c.req.raw.headers));
    if (isStub(config)) throw new Problem(503, "No scoring engine is configured on this deployment, so an edit cannot be retried.");
    const got = await rewriteLine(text, source, config);
    if (got === null) throw new Problem(503, "The reviewer could not write a different line right now. Try again in a moment.");
    const stored: ReviewBody = { ...current, rewrites: [{ source, rewrite: got }, ...current.rewrites.filter((item) => item.source !== source)].slice(0, MAX_REWRITES) };
    const saved = await one("UPDATE resume_reviews SET review = $2 WHERE resume_id = $1 RETURNING review, created_at", [id, seal(JSON.stringify(stored), reviewAad(id))]);
    return reviewJson(readReview(saved?.review, id), saved?.created_at, true);
});

routes.post("/review", jsonLimit, async (c) => {
    const input = await body<{ text?: unknown }>(c);
    const text = typeof input.text === "string" ? sanitize(input.text, LIMITS.chars) : "";
    if (!text) throw new Problem(422, "There is no resume text to review.");
    const config = configFrom(c.req.raw.headers);
    if (isStub(config)) throw new Problem(503, "No scoring engine is configured on this deployment, so a review cannot run.");
    const got = await reviewResume(text, config);
    if (got === null) throw new Problem(503, "The reviewer could not read this resume right now. Try again in a moment.");
    const parsed = validReview(got);
    if (parsed === null) throw new Problem(500, "Something went wrong.");
    return c.json({ ...parsed, created_at: new Date().toISOString(), stale: false, reads_at: readsAt(parsed.levels.map((level) => [level.level, level.call])) }, 201);
});

routes.post("/review/rewrite", jsonLimit, async (c) => {
    const input = await body<{ text?: unknown; source?: unknown }>(c);
    const text = typeof input.text === "string" ? sanitize(input.text, LIMITS.chars) : "";
    const source = claim(input.source, LINE_MAX);
    if (!text) throw new Problem(422, "There is no resume text to edit.");
    if (!source || !quotedBy(text, source)) throw new Problem(422, "That line is not on this resume any more. Re-review it and try again.");
    const config = configFrom(c.req.raw.headers);
    if (isStub(config)) throw new Problem(503, "No scoring engine is configured on this deployment, so an edit cannot be retried.");
    const got = await rewriteLine(text, source, config);
    if (got === null) throw new Problem(503, "The reviewer could not write a different line right now. Try again in a moment.");
    return c.json({ source, rewrite: got });
});

routes.post("/resumes/preview", jsonLimit, async (c) => {
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
