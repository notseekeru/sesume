import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export interface Session {
    Variables: { user: { id: string } };
}

const secret = process.env.AUTH_SECRET ?? "";
if (secret.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters");

const COOKIE = "sesume_session";
const TTL = 14 * 24 * 60 * 60 * 1000;
const derive = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt, 64);
    return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, salt, key] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !key) return false;
    const expected = Buffer.from(key, "base64url");
    const got = await derive(password, Buffer.from(salt, "base64url"), expected.length);
    return expected.length === got.length && timingSafeEqual(expected, got);
}

const signature = (payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function mintToken(id: string, expires = Date.now() + TTL): string {
    const payload = `${id}.${expires}`;
    return `${payload}.${signature(payload)}`;
}

export function issue(c: Context, id: string): void {
    // AI HERE: TLS is not terminated in this repo, so `secure` is on unless COOKIE_SECURE=false; drop the flag once a proxy always terminates TLS.
    const secure = process.env.COOKIE_SECURE !== "false";
    setCookie(c, COOKIE, mintToken(id), { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: TTL / 1000 });
}

export function clear(c: Context): void {
    deleteCookie(c, COOKIE, { path: "/" });
}

function read(c: Context): { id: string } | null {
    const raw = getCookie(c, COOKIE);
    if (!raw) return null;
    const [id, expires, sig] = raw.split(".");
    if (!id || !expires || !sig) return null;
    const expected = Buffer.from(signature(`${id}.${expires}`));
    const got = Buffer.from(sig);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    if (Number(expires) <= Date.now()) return null;
    return { id };
}

export const guard: MiddlewareHandler<Session> = async (c, next) => {
    const user = read(c);
    if (user === null) return c.json({ detail: "An account is required." }, 401);
    c.set("user", user);
    await next();
};
