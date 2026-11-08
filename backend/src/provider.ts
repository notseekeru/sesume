import { isIP } from "node:net";
import { open } from "./crypto.js";
import { pool } from "./db.js";

export const providerAad = (id: string, field: string) => `provider_configs.${field}:${id}`;

const BLOCKED_HOST = /^(localhost|metadata|metadata\.google\.internal)$/i;
const BLOCKED_SUFFIX = /\.(local|internal|localhost)$/i;

function publicHost(host: string): boolean {
    const family = isIP(host);
    if (family === 0) return !((BLOCKED_HOST.test(host) || BLOCKED_SUFFIX.test(host)) === true);
    if (family === 4) {
        const [a, b] = host.split(".").map(Number);
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 169 && b === 254) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        return true;
    }
    const v6 = host.toLowerCase();
    if (v6 === "::1" || v6 === "::" || v6.startsWith("::ffff:")) return false;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return false;
    return !/^fe[89ab]/.test(v6);
}

// The provider base URL is fetched by the worker, from inside the VPC, with the resume in the
// body. Without this a signed-up stranger could aim it at the database port or a metadata host.
// AI HERE: no DNS resolution, so a public hostname that resolves to a private address still gets
// through. Upgrade path: resolve before the fetch and pin the address with a custom dispatcher.
export function baseUrlAllowed(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== "https:") return false;
    if (url.username !== "" || url.password !== "") return false;
    return publicHost(url.hostname.replace(/^\[|\]$/g, ""));
}

export type ProviderRow = { base_url: string; model: string; api_key: string };

export async function storedProvider(userId: string): Promise<ProviderRow | null> {
    const found = await pool.query("SELECT base_url, model, api_key FROM provider_configs WHERE user_id = $1", [userId]);
    return (found.rows as ProviderRow[])[0] ?? null;
}

export async function providerHeaders(userId: string, headers: Headers): Promise<Headers> {
    const row = await storedProvider(userId);
    if (row === null) return headers;
    const out = new Headers(headers);
    out.set("x-llm-base-url", open(row.base_url, providerAad(userId, "base_url")));
    out.set("x-llm-model", open(row.model, providerAad(userId, "model")));
    out.set("x-llm-key", open(row.api_key, providerAad(userId, "api_key")));
    return out;
}
