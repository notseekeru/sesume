import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { type Session, viewer } from "./auth.js";

const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.RATE_LIMIT ?? 60);
const SWEEP_AT = 4096;

interface Bucket {
    count: number;
    reset: number;
}

const buckets = new Map<string, Bucket>();

// AI HERE: a fixed window held in the process. Ceiling: a deploy clears the counters, a second
// instance keeps its own, and a guest key trusts a forwarded header a direct client can forge.
export function hit(buckets: Map<string, Bucket>, key: string, now: number, limit = LIMIT): number {
    const found = buckets.get(key);
    if (found === undefined || found.reset <= now) {
        buckets.set(key, { count: 1, reset: now + WINDOW_MS });
        return 0;
    }
    if (found.count >= limit) return Math.ceil((found.reset - now) / 1000);
    found.count += 1;
    return 0;
}

function keyOf(c: Context<Session>): string | null {
    const user = viewer(c);
    if (user !== null) return `user:${user.id}`;
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return `ip:${forwarded}`;
    const real = c.req.header("x-real-ip");
    if (real) return `ip:${real}`;
    try {
        const remote = getConnInfo(c).remote.address;
        return remote ? `ip:${remote}` : null;
    } catch {
        return null;
    }
}

export const limit: MiddlewareHandler<Session> = async (c, next) => {
    const now = Date.now();
    if (buckets.size > SWEEP_AT) {
        for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
    }
    const key = keyOf(c);
    if (key !== null) {
        const wait = hit(buckets, key, now);
        if (wait > 0) return c.json({ detail: "Too many requests. Try again in a moment." }, 429, { "retry-after": String(wait) });
    }
    await next();
};
