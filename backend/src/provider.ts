import { open } from "./crypto.js";
import { pool } from "./db.js";

export const providerAad = (id: string, field: string) => `provider_configs.${field}:${id}`;

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
