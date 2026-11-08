import assert from "node:assert/strict";
import { test } from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.LLM_BASE_URL = "https://server.example/v1";
process.env.LLM_MODEL = "server-model";
process.env.LLM_API_KEY = "server-key";

const { configFrom } = await import("../src/llm.js");

const headers = (entries: Record<string, string>) => new Headers(entries);

test("with no stored provider the deployment's own key is used", () => {
    const config = configFrom(headers({}));
    assert.equal(config.baseUrl, "https://server.example/v1");
    assert.equal(config.apiKey, "server-key");
    assert.equal(config.byok, false);
});

test("a stored base URL never borrows the deployment's key", () => {
    const config = configFrom(headers({ "x-llm-base-url": "https://user.example/v1", "x-llm-model": "their-model" }));
    assert.equal(config.baseUrl, "https://user.example/v1");
    assert.equal(config.model, "their-model");
    assert.equal(config.apiKey, "");
    assert.equal(config.byok, true);
});

test("a stored base URL with no model is not a stub but has no key either", () => {
    const config = configFrom(headers({ "x-llm-base-url": "https://user.example/v1" }));
    assert.equal(config.model, "");
    assert.equal(config.apiKey, "");
});
