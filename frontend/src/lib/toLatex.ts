const ESCAPE: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    $: "\\$",
    "#": "\\#",
    _: "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
};

const FOLD: [RegExp, string][] = [
    [/[\u2013\u2014]/g, "--"],
    [/[\u2018\u2019]/g, "'"],
    [/[\u201c\u201d]/g, '"'],
    [/\u2026/g, "..."],
    [/[\u2022\u25aa\u25e6\u2023\u00b7]/g, " "],
    [/\u00a0/g, " "],
    [/[^\x20-\x7e\u00a0-\u00ff]/g, ""],
];

const texSafe = (line: string) => FOLD.reduce((out, [pattern, to]) => out.replace(pattern, to), line).replace(/[\\&%$#_{}~^]/g, (char) => ESCAPE[char]);

const BULLET = /^\s*(?:[\u2022\u25aa\u25e6\u2023*+-]|\u2013|\u2014)\s+/;
const HEADING = /^(?=.{2,48}$)[A-Z][A-Z0-9 &/,'().-]*$/;
const BREAK = String.raw`\\`;

const HEAD = String.raw`\documentclass[10pt,letterpaper]{article}
\usepackage[margin=0.75in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}`;

const BODY = String.raw`\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=3pt,parsep=0pt}
\titleformat{\section}{\large\bfseries}{}{0pt}{[\vspace{-6pt}\rule{\linewidth}{0.4pt}]}
\begin{document}`;

export function toLatex(text: string): string {
    const body: string[] = [];
    const flow: string[] = [];
    let bullets: string[] = [];
    let name = true;
    const head = text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !BULLET.test(line));
    const author = texSafe((head ?? "").split(/[|\u2022\u00b7\t]| {2,}|@/)[0].trim());
    const meta = /[a-z\u00a0-\u00ff]/i.test(author) ? `\n\\hypersetup{pdftitle={${author} resume}, pdfauthor={${author}}}` : "";

    function flushBullets() {
        if (!bullets.length) return;
        body.push(["\\begin{itemize}", ...bullets.map((item) => `  \\item ${item}`), "\\end{itemize}"].join("\n"));
        bullets = [];
    }

    function flushFlow() {
        if (!flow.length) return;
        body.push(flow.map((line) => line + BREAK).join("\n"));
        flow.length = 0;
    }

    function flush() {
        flushBullets();
        flushFlow();
    }

    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line) {
            flush();
            continue;
        }
        if (name && !BULLET.test(raw)) {
            flush();
            const title = texSafe(line);
            if (title) flow.push(`{\\LARGE\\bfseries ${title}}`);
            name = false;
            continue;
        }
        if (!BULLET.test(raw) && HEADING.test(line)) {
            flush();
            body.push(`\\section*{${texSafe(line)}}`);
            continue;
        }
        if (BULLET.test(raw)) {
            flushFlow();
            bullets.push(texSafe(line.replace(BULLET, "")));
            name = false;
            continue;
        }
        if (bullets.length && /^[a-z(]/.test(line)) {
            bullets[bullets.length - 1] += ` ${texSafe(line)}`;
            continue;
        }
        flushBullets();
        flow.push(texSafe(line));
    }
    flush();

    return `${HEAD}${meta}\n${BODY}\n\n${body.join("\n\n")}\n\n\\end{document}\n`;
}

if (import.meta.env.DEV) {
    const out = toLatex("ALEX MENDER\nSKILLS\n\u2022 Go & Rust_ #1\ncontinued here \u2013 done");
    const contact = toLatex("ALEX MENDER | +63 9000 | alex@mail.com\nSKILLS");
    const unnamed = toLatex("\u674e\u660e\nSKILLS");
    const ok = ["\\documentclass", "pdfauthor={ALEX MENDER}", "{\\LARGE\\bfseries ALEX MENDER}", "\\section*{SKILLS}", "Go \\& Rust\\_ \\#1 continued here -- done", "\\end{document}"].every((part) => out.includes(part));
    const guarded = contact.includes("pdfauthor={ALEX MENDER}") && !contact.includes("+63") && !unnamed.includes("pdfauthor") && !unnamed.includes("\\bfseries }");
    if (!ok || !guarded || out.includes("\u2013") || out.includes("\\section*{ALEX MENDER}")) console.error("toLatex: self-check failed");
}
