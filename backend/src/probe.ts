import { ready } from "./bootstrap.js";

const url = process.env.PROBE_URL ?? "";

// Throwing is the whole signal: the sesume-probe-errors alarm watches this function and mails the
// topic. No SNS call here on purpose, one place owns the alert.
export async function handler(): Promise<void> {
    await ready();
    if (url === "") throw new Error("PROBE_URL is not set");
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    if (!response.ok || !body.includes('"ok"')) {
        throw new Error(`probe failed: ${response.status} ${body.slice(0, 200)}`);
    }
}
