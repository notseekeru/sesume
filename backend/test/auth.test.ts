import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";

const { hashPassword, verifyPassword } = await import("../src/auth.js");

test("a password verifies only against its own hash", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", stored), true);
    assert.equal(await verifyPassword("correct horse battery stapl3", stored), false);
});

test("the same password hashes differently every time", async () => {
    assert.notEqual(await hashPassword("same-password"), await hashPassword("same-password"));
});
