import assert from "node:assert/strict";
import { test } from "node:test";
import { ExtractError, extractPdf, LIMITS, sanitize } from "../src/resumes.js";
import { claim, extractJsonObject, FIELD_MAX, quotedBy, RUNGS, readsAt, rungOf, slug, staircase, validReview } from "../src/review.js";

const bytes = (value: string) => new TextEncoder().encode(value);

function buildPdf(pages: number, text: string): Uint8Array {
    const content = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : "";
    const contentId = pages + 3;
    const fontId = pages + 4;
    const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(" ");
    const bodies = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
        ...Array.from({ length: pages }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`),
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (const [index, body] of bodies.entries()) {
        offsets.push(out.length);
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return bytes(out);
}

async function withLimits<T>(patch: Partial<typeof LIMITS>, task: () => Promise<T>): Promise<T> {
    const saved = { ...LIMITS };
    Object.assign(LIMITS, patch);
    try {
        return await task();
    } finally {
        Object.assign(LIMITS, saved);
    }
}

test("sanitize folds, expands and strips invisibles", () => {
    assert.equal(sanitize("\ufb01le  \u00a0name"), "file name");
    assert.equal(sanitize("a\u200bb\u202ec"), "abc");
    assert.equal(sanitize("A\n\n\n\nB\t\tC "), "A\n\nB C");
    assert.equal(sanitize("x".repeat(100), 10), "x".repeat(10));
});

test("extraction reads the text of a real PDF", async () => {
    const got = await extractPdf(buildPdf(1, "Alex Mender - Platform Engineer"));
    assert.match(got.text, /Alex Mender/);
    assert.match(got.text, /Platform Engineer/);
    assert.deepEqual([got.pages, got.truncated], [1, false]);
});

test("a body that is not a PDF is rejected", async () => {
    for (const body of ["<html>hello</html>", "PK\u0003\u0004zip", "", "\u0089PNG\r\n\u001a\n"]) {
        await assert.rejects(
            () => extractPdf(bytes(body)),
            (error: unknown) => error instanceof ExtractError && /isn't a PDF/.test(error.message),
        );
    }
});

test("magic bytes are found past byte zero", async () => {
    const got = await extractPdf(new Uint8Array([...bytes("garbage-prefix\n"), ...buildPdf(1, "Hello Resume")]));
    assert.match(got.text, /Hello Resume/);
});

test("an oversize upload is rejected before parsing", async () => {
    await withLimits({ bytes: 64 }, async () => {
        await assert.rejects(() => extractPdf(buildPdf(1, "Hello Resume")), /larger than/);
    });
});

test("the page cap reads only the first pages", async () => {
    const got = await withLimits({ pages: 3 }, () => extractPdf(buildPdf(10, "Hello Resume")));
    assert.equal(got.pages, 3);
    assert.equal(got.truncated, true);
});

test("the char cap stops early", async () => {
    const got = await withLimits({ chars: 40 }, () => extractPdf(buildPdf(10, "Hello Resume")));
    assert.ok(got.text.length <= 40);
    assert.equal(got.truncated, true);
});

test("an image-only PDF points at the paste path", async () => {
    await assert.rejects(() => extractPdf(buildPdf(1, "")), /Paste the text instead/);
});

test("the ladder clamps to the rung below", () => {
    assert.deepEqual(
        staircase([
            ["mid", "passes"],
            ["senior", "fails"],
            ["staff", "passes"],
        ]),
        [
            [
                ["mid", "passes"],
                ["senior", "fails"],
                ["staff", "fails"],
            ],
            true,
        ],
    );
    const calls = ["passes", "passes", "passes", "close", "fails", "fails"] as const;
    assert.equal(staircase(RUNGS.map((rung, index) => [rung, calls[index]]) as [string, "passes" | "close" | "fails"][])[1], false);
    assert.equal(
        readsAt([
            ["junior", "passes"],
            ["senior", "fails"],
        ]),
        "junior",
    );
    assert.equal(readsAt([["junior", "fails"]]), null);
    assert.equal(readsAt([]), null);
});

test("slugs and rungs survive the weak-backend path", () => {
    assert.deepEqual([slug("Mid Level"), slug(" senior "), slug(7)], ["mid_level", "senior", null]);
    assert.deepEqual([rungOf("Mid-level"), rungOf(" SENIOR "), rungOf("staff engineer"), rungOf("nonsense")], ["mid", "senior", "staff", null]);
    assert.equal(claim(" a\n\n b "), "a b");
    assert.equal(claim("x".repeat(FIELD_MAX + 10)).length, FIELD_MAX);
});

test("a quote is found in the text it came from", () => {
    const text = "ALEX MENDER\nEXPERIENCE\nBuilt the thing that moved the number";
    assert.equal(quotedBy(text, "Built the thing that moved the number"), true);
    assert.equal(quotedBy(text, "Built   the thing"), true);
    assert.equal(quotedBy(text, "Led a team of 40"), false);
    assert.equal(quotedBy(text, ""), false);
});

const reviewBody = (overrides: Record<string, unknown> = {}) => ({
    verdict: "Mid-level page: the numbers are missing.",
    levels: RUNGS.map((rung, index) => ({ level: rung, call: ["passes", "passes", "passes", "close", "fails", "fails"][index], thinks: "the page says so", move: index > 2 ? "add the number" : "" })),
    sections: [{ name: "Experience", call: "fine", note: "thin" }],
    rewrites: [{ source: "Built things", rewrite: "Built [which thing]" }],
    lines: [{ text: "Built things", call: "weak" }],
    ...overrides,
});

test("a review is kept only when every rung is graded", () => {
    const got = validReview(reviewBody());
    assert.ok(got !== null);
    assert.deepEqual(
        got?.levels.map((level) => level.level),
        [...RUNGS],
    );
    const clamped = validReview(reviewBody({ levels: RUNGS.map((rung, index) => ({ level: rung, call: index === 3 ? "fails" : "passes", thinks: "why", move: "" })) }));
    assert.deepEqual(
        clamped?.levels.slice(3).map((level) => level.call),
        ["fails", "fails", "fails"],
    );
    assert.equal(validReview(reviewBody({ levels: [{ level: "senior", call: "passes", thinks: "why", move: "" }] })), null);
    assert.equal(validReview(reviewBody({ rewrites: [] })), null);
    assert.equal(validReview(reviewBody({ verdict: "" })), null);
    assert.equal(validReview("nope"), null);
});

test("a JSON object is found inside model prose", () => {
    assert.deepEqual(extractJsonObject('here you go: {"verdict": "fine", "n": 1} thanks'), { verdict: "fine", n: 1 });
    assert.deepEqual(extractJsonObject('{"a": "}"}'), { a: "}" });
    assert.equal(extractJsonObject("no object here"), null);
});
