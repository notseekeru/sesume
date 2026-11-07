import assert from "node:assert/strict";
import { test } from "node:test";

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { handler } = await import("../src/lambda.js");

const event = (path: string) => ({
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { host: "localhost" },
    requestContext: {
        accountId: "test",
        apiId: "test",
        domainName: "localhost",
        domainPrefix: "test",
        http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
        requestId: "test",
        routeKey: "$default",
        stage: "$default",
        time: "",
        timeEpoch: 0,
    },
    isBase64Encoded: false,
});

test("the lambda handler answers the app's own routes", async () => {
    const answer = await handler(event("/api/nope"), {} as never, () => undefined);
    assert.equal(answer.statusCode, 404);
    assert.deepEqual(JSON.parse(String(answer.body)), { detail: "Not found" });
});
