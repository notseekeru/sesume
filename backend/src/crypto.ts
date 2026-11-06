import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const MARK = "v1:";

const key = Buffer.from(process.env.DATA_KEY ?? "", "base64");
if (key.length !== 32) throw new Error("DATA_KEY must be 32 bytes, base64 encoded");

// AI HERE: one process-wide key from the env, no KMS. Ceiling: rotating the key means decrypting and
// re-sealing every row by hand, and a lost key loses the data. Upgrade path: wrap this key with a KMS key.
export function seal(plain: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [MARK + iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(value: string, aad: string): string {
    if (!value.startsWith(MARK)) return value;
    const [iv, tag, body] = value.slice(MARK.length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
