import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const LIMITS = {
    bytes: Number(process.env.RESUME_MAX_BYTES ?? 2 * 1024 * 1024),
    pages: Number(process.env.RESUME_MAX_PAGES ?? 15),
    chars: Number(process.env.RESUME_MAX_CHARS ?? 60000),
};
const PARSE_CONCURRENCY = Number(process.env.RESUME_PARSE_CONCURRENCY ?? 2);

export const TOO_LARGE = `That file is larger than ${LIMITS.bytes / (1024 * 1024)} MB. Trim it down, or paste the text instead.`;

const PDF_MAGIC = "%PDF-";

export class ExtractError extends Error {}

export interface Extracted {
    text: string;
    pages: number;
    truncated: boolean;
}

let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(task: () => Promise<T>): Promise<T> {
    if (running < PARSE_CONCURRENCY) running += 1;
    else
        await new Promise<void>((resolve) => {
            const grant = () => {
                running += 1;
                resolve();
            };
            waiting.push(grant);
        });
    try {
        return await task();
    } finally {
        running -= 1;
        waiting.shift()?.();
    }
}

export function sanitize(text: string, limit = LIMITS.chars): string {
    const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").normalize("NFKC");
    const kept = [...normalized].filter((char) => char === "\n" || !/[\p{Cc}\p{Cf}]/u.test(char)).join("");
    const trimmed = kept
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n");
    const folded = trimmed
        .replace(/ {2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return [...folded].slice(0, limit).join("");
}

function hasPdfHeader(data: Uint8Array): boolean {
    return new TextDecoder("latin1").decode(data.subarray(0, 1024)).includes(PDF_MAGIC);
}

async function parse(data: Uint8Array): Promise<Extracted> {
    const task = getDocument({ data, useSystemFonts: true, verbosity: 0 });
    let doc: Awaited<typeof task.promise>;
    try {
        doc = await task.promise;
    } catch (error) {
        const name = (error as { name?: string }).name;
        await task.destroy().catch(() => undefined);
        if (name === "PasswordException") throw new ExtractError("That PDF is password-protected. Remove the password, or paste the text instead.");
        throw new ExtractError("That file isn't a PDF. Upload a PDF, or paste the text instead.");
    }

    const body: string[] = [];
    let pages = 0;
    let total = 0;
    let truncated = false;
    try {
        for (let index = 0; index < doc.numPages; index += 1) {
            if (index >= LIMITS.pages || total >= LIMITS.chars) {
                truncated = true;
                break;
            }
            let chunk: string;
            try {
                const page = await doc.getPage(index + 1);
                const content = await page.getTextContent();
                chunk = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join("");
                page.cleanup();
            } catch {
                console.warn("resume.page_unreadable", index + 1);
                truncated = true;
                continue;
            }
            pages += 1;
            total += chunk.length;
            body.push(chunk);
        }
    } finally {
        await task.destroy();
    }

    const text = sanitize(body.join("\n"), LIMITS.chars);
    if (!text) throw new ExtractError("No selectable text in that PDF: it looks like a scan or an image export. Paste the text instead.");
    return { text, pages, truncated };
}

export async function extractPdf(data: Uint8Array): Promise<Extracted> {
    if (data.byteLength > LIMITS.bytes) throw new ExtractError(TOO_LARGE);
    if (!hasPdfHeader(data)) throw new ExtractError("That file isn't a PDF. Upload a PDF, or paste the text instead.");
    return slot(() => parse(data));
}
