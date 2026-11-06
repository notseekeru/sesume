import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { app } = await import("../src/index.js");
const { pool } = await import("../src/db.js");
const { hit } = await import("../src/rate.js");

after(async () => {
    await pool.end();
});

test("a key spends its budget, other keys do not, and the window reopens", () => {
    const buckets = new Map<string, { count: number; reset: number }>();
    const start = 1_000;
    assert.equal(hit(buckets, "ip:1", start, 3), 0);
    assert.equal(hit(buckets, "ip:1", start + 1, 3), 0);
    assert.equal(hit(buckets, "ip:1", start + 2, 3), 0);
    assert.equal(hit(buckets, "ip:1", start + 3, 3), 60);
    assert.equal(hit(buckets, "ip:2", start + 3, 3), 0);
    assert.equal(hit(buckets, "ip:1", start + 60_000, 3), 0);
});

test("the sixtieth request passes and the next one is turned away", async () => {
    const init = { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } };
    for (let sent = 0; sent < 60; sent += 1) {
        assert.equal((await app.request("/api/auth/logout", init)).status, 204);
    }
    const blocked = await app.request("/api/auth/logout", init);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});
