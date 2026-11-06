import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");

const { open, seal } = await import("../src/crypto.js");

const AAD = "resumes.text:6f9c1f36-0f6f-4a1c-9ee5-3b0e0f1a2c34";

test("a sealed value reads back and leaves the plaintext behind", () => {
    const sealed = seal("Ada Lovelace", AAD);
    assert.ok(sealed.startsWith("v1:"));
    assert.equal(sealed.includes("Ada"), false);
    assert.equal(open(sealed, AAD), "Ada Lovelace");
    assert.notEqual(seal("Ada Lovelace", AAD), sealed);
});

test("a value sealed for another row does not open", () => {
    const sealed = seal("Ada Lovelace", AAD);
    assert.throws(() => open(sealed, "resumes.text:other"));
});

test("a tampered tag does not open", () => {
    const [mark, iv, tag, body] = seal("Ada Lovelace", AAD).split(".");
    const flipped = `${tag.slice(0, -2)}${tag.slice(-2) === "AA" ? "BA" : "AA"}`;
    assert.throws(() => open([mark, iv, flipped, body].join("."), AAD));
});

test("a value written before encryption reads through as plaintext", () => {
    assert.equal(open("{\\section*{Ada}}", AAD), "{\\section*{Ada}}");
});
