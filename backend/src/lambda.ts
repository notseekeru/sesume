import { handle } from "hono/aws-lambda";
import { ready } from "./bootstrap.js";

type LambdaHandler = ReturnType<typeof handle>;

let built: Promise<LambdaHandler> | null = null;

async function build(): Promise<LambdaHandler> {
    await ready();
    const { default: app } = await import("./index.js");
    return handle(app);
}

export const handler: LambdaHandler = async (event, context) => {
    // Same reason as bootstrap: a failed build is retried on the next invocation, not cached.
    built ??= build().catch((error: unknown) => {
        built = null;
        throw error;
    });
    const run = await built;
    return run(event, context);
};
