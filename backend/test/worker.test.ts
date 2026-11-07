import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATA_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";

const { jobOf } = await import("../src/worker.js");

test("a queue message only becomes a job when both ids are strings", () => {
    assert.deepEqual(jobOf('{"resumeId":"a","userId":"b"}'), { resumeId: "a", userId: "b" });
    assert.equal(jobOf("not json"), null);
    assert.equal(jobOf('{"resumeId":"a"}'), null);
    assert.equal(jobOf("null"), null);
});
