import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

const COMPILE_TIMEOUT = Number(process.env.LATEX_TIMEOUT ?? 20) * 1000;
// One compile per core but the last, so the server keeps a thread for itself.
const COMPILE_CONCURRENCY = Number(process.env.LATEX_CONCURRENCY ?? Math.max(2, availableParallelism() - 1));
const QUEUE_WAIT = Number(process.env.LATEX_QUEUE_WAIT ?? 5) * 1000;
const MEMORY_MB = Number(process.env.LATEX_MEMORY_MB ?? 192);
const MAX_OUTPUT = 4000;
const LOG_TAIL = 1200;

const ARGS = ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-cnf-line=openin_any=p", "-cnf-line=openout_any=p", "main.tex"];

export class CompileError extends Error {}
export class CompileBusy extends Error {}

let probe: boolean | null = null;

export function available(): boolean {
    probe ??= spawnSync("pdflatex", ["--version"], { stdio: "ignore" }).status === 0;
    return probe;
}

// AI HERE: one engine, one pass. Ceiling: a document that needs bibtex or a second pass renders with
// unresolved references. Upgrade path: rerun when the log asks for it.
function firstError(log: string): string {
    const lines = log
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const hit = lines.find((line) => line.startsWith("!") || line.includes(".tex:"));
    if (hit) return hit.slice(0, LOG_TAIL);
    if (log.includes("No pages of output")) return "This document produces no pages: nothing is inside the body.";
    return (lines.at(-1) ?? "pdflatex failed without a message.").slice(0, LOG_TAIL);
}

let running = 0;
const waiting: (() => void)[] = [];

async function acquire(waitMs: number): Promise<boolean> {
    if (running < COMPILE_CONCURRENCY) {
        running += 1;
        return true;
    }
    return new Promise<boolean>((resolve) => {
        const grant = () => {
            clearTimeout(timer);
            running += 1;
            resolve(true);
        };
        waiting.push(grant);
        const timer = setTimeout(() => {
            const at = waiting.indexOf(grant);
            if (at >= 0) waiting.splice(at, 1);
            resolve(false);
        }, waitMs);
    });
}

function release(): void {
    running -= 1;
    waiting.shift()?.();
}

async function run(source: string): Promise<Uint8Array<ArrayBuffer>> {
    const workdir = await mkdtemp(join(tmpdir(), "latex-"));
    try {
        await writeFile(join(workdir, "main.tex"), source, "utf8");
        const command = `ulimit -v ${MEMORY_MB * 1024} 2>/dev/null; ulimit -t ${Math.ceil(COMPILE_TIMEOUT / 1000)} 2>/dev/null; exec pdflatex ${ARGS.join(" ")}`;
        const child = spawn("sh", ["-c", command], {
            cwd: workdir,
            stdio: ["ignore", "pipe", "pipe"],
            env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: workdir, TEXMFVAR: join(workdir, ".texmf") },
        });
        const chunks: Buffer[] = [];
        const collect = (chunk: Buffer) => {
            if (chunks.length < MAX_OUTPUT) chunks.push(chunk);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, COMPILE_TIMEOUT);
        const code = await new Promise<number | null>((resolve) => {
            child.once("close", resolve);
            child.once("error", () => resolve(null));
        });
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString("utf8").slice(0, MAX_OUTPUT);

        if (timedOut) throw new CompileError(`pdflatex ran longer than ${COMPILE_TIMEOUT / 1000}s. Check the document for a runaway command.`);
        if (code !== 0) throw new CompileError(firstError(output));
        try {
            return Uint8Array.from(await readFile(join(workdir, "main.pdf")));
        } catch {
            throw new CompileError(firstError(output));
        }
    } finally {
        await rm(workdir, { recursive: true, force: true });
    }
}

export async function compilePdf(source: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!available()) throw new CompileError("No LaTeX engine is installed on this deployment.");
    if (!(await acquire(QUEUE_WAIT))) throw new CompileBusy();
    try {
        return await run(source);
    } finally {
        release();
    }
}
