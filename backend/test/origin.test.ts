import assert from "node:assert/strict";
import { test } from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.ORIGIN_TOKEN = "test-origin-token";

const { app } = await import("../src/index.js");

test("a request that bypassed the edge is refused", async () => {
    const response = await app.request("/api/nope");
    assert.equal(response.status, 403);
});

test("a request carrying the edge token reaches the routes", async () => {
    const response = await app.request("/api/nope", { headers: { "x-origin-token": "test-origin-token" } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).detail, "Not found");
});

test("a wrong token is refused", async () => {
    const response = await app.request("/api/nope", { headers: { "x-origin-token": "wrong" } });
    assert.equal(response.status, 403);
});
