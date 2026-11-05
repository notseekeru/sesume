export const DOCUMENT = "\\documentclass";

export function isLatex(text: string): boolean {
    return text.includes(DOCUMENT);
}

export type LatexKind = "plain" | "command" | "comment" | "math";

export interface LatexToken {
    text: string;
    kind: LatexKind;
}

const TOKEN = /(%.*$)|(\$[^$]*\$)|(\\(?:[a-zA-Z@]+|.))/g;

export function tokenize(line: string): LatexToken[] {
    const tokens: LatexToken[] = [];
    let last = 0;
    for (const match of line.matchAll(TOKEN)) {
        const at = match.index ?? 0;
        if (at > last) tokens.push({ text: line.slice(last, at), kind: "plain" });
        tokens.push({ text: match[0], kind: match[1] ? "comment" : match[2] ? "math" : "command" });
        last = at + match[0].length;
    }
    if (last < line.length) tokens.push({ text: line.slice(last), kind: "plain" });
    return tokens;
}
