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
    built ??= build();
    const run = await built;
    return run(event, context);
};
