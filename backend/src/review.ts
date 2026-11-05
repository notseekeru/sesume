import { createHash } from "node:crypto";

export const RUNGS = ["intern", "junior", "mid", "senior", "staff", "principal"] as const;
export const CALLS = ["fails", "close", "passes"] as const;
export const SECTION_CALLS = ["bloat", "weak", "fine", "strong"] as const;
export const LINE_CALLS = ["weak", "safe", "strong"] as const;

export type Rung = (typeof RUNGS)[number];
export type Call = (typeof CALLS)[number];
export type SectionCall = (typeof SECTION_CALLS)[number];
export type LineCall = (typeof LINE_CALLS)[number];

export const LEVEL_LABELS: Record<Rung, string> = {
    intern: "Intern",
    junior: "Junior",
    mid: "Mid-level",
    senior: "Senior",
    staff: "Staff",
    principal: "Principal",
};

export const MAX_SECTIONS = 6;
export const MAX_REWRITES = 3;
export const MAX_LINES = 24;
export const NAME_MAX = 40;
export const FIELD_MAX = 300;
export const LINE_MAX = 400;
export const VERDICT_MAX = 1200;

export interface ReviewLevel {
    level: Rung;
    call: Call;
    thinks: string;
    move: string;
}

export interface ReviewSection {
    name: string;
    call: SectionCall;
    note: string;
}

export interface ReviewRewrite {
    source: string;
    rewrite: string;
}

export interface ReviewLine {
    text: string;
    call: LineCall;
}

export interface ReviewBody {
    verdict: string;
    levels: ReviewLevel[];
    sections: ReviewSection[];
    rewrites: ReviewRewrite[];
    lines: ReviewLine[];
}

const RUNG_INDEX = new Map<string, number>(RUNGS.map((rung, index) => [rung, index]));
const CALL_INDEX = new Map<string, number>(CALLS.map((call, index) => [call, index]));

export function slug(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_") || null
    );
}

export function rungOf(value: unknown): Rung | null {
    const got = slug(value);
    if (got === null) return null;
    return RUNGS.find((rung) => got === rung) ?? RUNGS.find((rung) => got.startsWith(rung)) ?? null;
}

export function claim(value: unknown, limit = FIELD_MAX): string {
    if (typeof value !== "string") return "";
    return value.split(/\s+/).filter(Boolean).join(" ").slice(0, limit);
}

export function staircase(calls: [string, Call][]): [[Rung, Call][], boolean] {
    const ceiling = CALLS.length - 1;
    let clamped = false;
    let limit = ceiling;
    const ladder: [Rung, Call][] = [];
    for (const [rung, call] of [...calls].sort((a, b) => (RUNG_INDEX.get(a[0]) ?? 0) - (RUNG_INDEX.get(b[0]) ?? 0))) {
        const rank = Math.min(CALL_INDEX.get(call) ?? ceiling, limit);
        clamped ||= rank !== CALL_INDEX.get(call);
        limit = rank;
        ladder.push([rung as Rung, CALLS[rank]]);
    }
    return [ladder, clamped];
}

export function readsAt(calls: [string, string][]): Rung | null {
    const passed = calls.filter(([, call]) => call === "passes").map(([rung]) => rung as Rung);
    return passed.reduce<Rung | null>((best, rung) => (best === null || (RUNG_INDEX.get(rung) ?? 0) > (RUNG_INDEX.get(best) ?? 0) ? rung : best), null);
}

export function sourceHash(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

const flatten = (value: string) => value.split(/\s+/).filter(Boolean).join(" ");

export function quotedBy(text: string, source: string): boolean {
    return source !== "" && (text.includes(source) || flatten(text).includes(flatten(source)));
}

function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function validReview(raw: unknown): ReviewBody | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const verdict = claim(obj.verdict, VERDICT_MAX);
    if (!verdict) return null;

    const rungs = new Map<Rung, { call: Call; thinks: string; move: string }>();
    for (const item of list(obj.levels)) {
        if (typeof item !== "object" || item === null) continue;
        const row = item as Record<string, unknown>;
        const rung = rungOf(row.level);
        const call = slug(row.call);
        if (rung === null || !CALLS.includes(call as Call) || rungs.has(rung)) continue;
        rungs.set(rung, { call: call as Call, thinks: claim(row.thinks), move: claim(row.move) });
    }
    if (rungs.size !== RUNGS.length) {
        console.warn("llm.review.ladder_incomplete", rungs.size);
        return null;
    }
    const [ladder, clamped] = staircase(RUNGS.map((rung) => [rung, rungs.get(rung)?.call as Call]));
    if (clamped) console.warn("llm.review.ladder_clamped");
    if (RUNGS.some((rung) => !rungs.get(rung)?.thinks)) return null;

    const sections: ReviewSection[] = [];
    for (const item of list(obj.sections)) {
        if (typeof item !== "object" || item === null) continue;
        const row = item as Record<string, unknown>;
        const call = slug(row.call);
        const name = claim(row.name, NAME_MAX);
        if (SECTION_CALLS.includes(call as SectionCall) && name) sections.push({ name, call: call as SectionCall, note: claim(row.note) });
    }
    if (!sections.length) {
        console.warn("llm.review.sections_missing");
        return null;
    }

    const rewrites: ReviewRewrite[] = [];
    for (const item of list(obj.rewrites)) {
        if (typeof item !== "object" || item === null) continue;
        const row = item as Record<string, unknown>;
        const source = claim(row.source, LINE_MAX);
        const rewrite = claim(row.rewrite, LINE_MAX);
        if (source && rewrite) rewrites.push({ source, rewrite });
    }
    if (!rewrites.length) {
        console.warn("llm.review.rewrites_missing");
        return null;
    }

    const lines: ReviewLine[] = [];
    for (const item of list(obj.lines)) {
        if (typeof item !== "object" || item === null) continue;
        const row = item as Record<string, unknown>;
        const call = slug(row.call);
        const text = claim(row.text, LINE_MAX);
        if (LINE_CALLS.includes(call as LineCall) && text) lines.push({ text, call: call as LineCall });
    }
    if (!lines.length) console.warn("llm.review.lines_missing");

    return {
        verdict,
        levels: ladder.map(([rung, call]) => ({ level: rung, call, thinks: rungs.get(rung)?.thinks ?? "", move: rungs.get(rung)?.move ?? "" })),
        sections: sections.slice(0, MAX_SECTIONS),
        rewrites: rewrites.slice(0, MAX_REWRITES),
        lines: lines.slice(0, MAX_LINES),
    };
}

export function extractJsonObject(text: string): unknown {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, index + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}
