import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { app } = await import("../src/index.js");
const { pool } = await import("../src/db.js");
const { mintToken } = await import("../src/auth.js");

const USER = "6f9c1f36-0f6f-4a1c-9ee5-3b0e0f1a2c34";
const session = (token = mintToken(USER)) => ({ cookie: `sesume_session=${token}` });

after(async () => {
    await pool.end();
});

test("an unknown route answers JSON 404", async () => {
    const response = await app.request("/api/nope");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { detail: "Not found" });
});

test("a known path with the wrong method answers 405 with Allow", async () => {
    const response = await app.request("/api/resumes", { method: "PATCH" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST");
});

test("an oversized JSON body is refused before parsing", async () => {
    const response = await app.request("/api/resumes", {
        method: "POST",
        headers: { "content-type": "application/json", ...session() },
        body: JSON.stringify({ name: "x", text: "y".repeat(600 * 1024) }),
    });
    assert.equal(response.status, 413);
});

test("health reports down when the database is unreachable", async () => {
    const response = await app.request("/api/healthz");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "down" });
});

test("resumes answer 401 without a session", async () => {
    const response = await app.request("/api/resumes");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { detail: "Sign in to continue." });
});

test("a session cookie is honoured only when it is intact and unexpired", async () => {
    const forged = await app.request("/api/resumes", { headers: session(`${mintToken(USER).slice(0, -2)}xx`) });
    const expired = await app.request("/api/resumes", { headers: session(mintToken(USER, Date.now() - 1000)) });
    const intact = await app.request("/api/resumes", { headers: session() });
    assert.equal(forged.status, 401);
    assert.equal(expired.status, 401);
    assert.notEqual(intact.status, 401);
});
