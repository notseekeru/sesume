interface Span {
    from: number;
    to: number;
}

const flatten = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const MIN_NAMED = 12;

function locate(flat: string[], quote: string): Span | null {
    const target = flatten(quote);
    if (!target) return null;
    const starts: number[] = [];
    let joined = "";
    for (const line of flat) {
        starts.push(joined.length);
        joined += `${line} `;
    }
    const at = joined.indexOf(target);
    if (at >= 0) {
        const lineAt = (offset: number) => {
            let found = 0;
            for (let i = 0; i < starts.length; i += 1) if (starts[i] <= offset) found = i;
            return found;
        };
        return { from: lineAt(at), to: lineAt(at + target.length - 1) };
    }
    if (target.length < MIN_NAMED) return null;
    const at2 = flat.findIndex((line) => line.length >= MIN_NAMED && (line.includes(target) || target.includes(line)));
    return at2 >= 0 ? { from: at2, to: at2 } : null;
}

export function lineOf(text: string, quote: string): number | null {
    return locate(text.split("\n").map(flatten), quote)?.from ?? null;
}

export type LineCall = "weak" | "safe" | "strong";

export interface Suggestion {
    source: string;
    rewrite: string;
}

export interface QuotedLine {
    text: string;
    call: LineCall;
}

export function callByLine(text: string, quotes: QuotedLine[]): Map<number, LineCall> {
    const flat = text.split("\n").map(flatten);
    const calls = new Map<number, LineCall>();
    for (const quote of quotes) {
        const span = locate(flat, quote.text);
        if (!span) continue;
        for (let index = span.from; index <= span.to; index += 1) calls.set(index, quote.call);
    }
    return calls;
}

export function offsetOf(text: string, quote: string): number | null {
    const line = lineOf(text, quote);
    if (line === null) return null;
    return text
        .split("\n")
        .slice(0, line)
        .reduce((offset, value) => offset + value.length + 1, 0);
}

export function replaceLine(text: string, source: string, rewrite: string): string | null {
    const lines = text.split("\n");
    const span = locate(lines.map(flatten), source);
    if (!span) return null;
    lines.splice(span.from, span.to - span.from + 1, rewrite);
    return lines.join("\n");
}

if (import.meta.env.DEV) {
    const resume = "ALEX\n• Built the thing\n• Cut p95 20%";
    const replaced = replaceLine(resume, "BUILT  THE THING", "Built the thing that shipped");
    const offsets = [offsetOf(resume, "Cut p95 20%"), lineOf(resume, "Cut p95 20%")];
    if (replaced !== "ALEX\nBuilt the thing that shipped\n• Cut p95 20%" || offsets[0] !== 23 || offsets[1] !== 2) console.error("resumeText: self-check failed");
}
