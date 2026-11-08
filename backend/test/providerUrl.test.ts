import assert from "node:assert/strict";
import { test } from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { baseUrlAllowed } = await import("../src/provider.js");

const allowed = ["https://api.openai.com/v1", "https://integrate.api.nvidia.com/v1", "https://api.example.com:8443/v1", "https://openrouter.ai/api/v1/"];

const refused = [
    "http://api.openai.com/v1",
    "https://10.0.11.140:5432",
    "https://10.0.0.171",
    "https://172.20.0.1/v1",
    "https://192.168.1.1/v1",
    "https://127.0.0.1:8080",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/v1",
    "https://localhost:8080/v1",
    "https://metadata.google.internal/v1",
    "https://db.internal/v1",
    "https://[::1]/v1",
    "https://[fd00::1]/v1",
    "https://user:pass@api.example.com/v1",
    "https://localhost./v1",
    "https://db.internal./v1",
    "https://10.0.0.1./v1",
    "not a url",
    "",
];

test("public https endpoints are accepted", () => {
    for (const url of allowed) assert.equal(baseUrlAllowed(url), true, url);
});

test("everything the worker must not be aimed at is refused", () => {
    for (const url of refused) assert.equal(baseUrlAllowed(url), false, url);
});
