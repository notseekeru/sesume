import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, compileLatex, createResume, deleteResume, extractResume, getResume, getResumeReview, listResumes, loadProvider, type Provider, type ResumeReview, type ResumeSummary, type ReviewLevel, retryRewrite, reviewResume, saveProvider, updateResume } from "../lib/api";
import { lineOf, offsetOf, replaceLine } from "../lib/resumeText";
import { toLatex } from "../lib/toLatex";

interface Draft {
    id: string | null;
    name: string;
    text: string;
}

const EMPTY: Draft = { id: null, name: "", text: "" };
const BURST_MS = 700;
const MAX_UNDO = 30;
const DEBOUNCE_MS = 900;

const LEVEL_LABEL: Record<string, string> = { intern: "Intern", junior: "Junior", mid: "Mid-level", senior: "Senior", staff: "Staff", principal: "Principal" };
const CALL_LABEL: Record<string, string> = { passes: "Passes", close: "Close", fails: "Fails" };

interface UndoStep {
    text: string;
    source?: string;
}

export default function ResumePage() {
    const [rows, setRows] = useState<ResumeSummary[]>([]);
    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [review, setReview] = useState<ResumeReview | null>(null);
    const [past, setPast] = useState<UndoStep[]>([]);
    const [future, setFuture] = useState<UndoStep[]>([]);
    const [finished, setFinished] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [reviewing, setReviewing] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [pasting, setPasting] = useState(false);
    const [provider, setProvider] = useState<Provider>(() => loadProvider());
    const area = useRef<HTMLTextAreaElement>(null);
    const burst = useRef(0);

    const editing = draft.id !== null || pasting || importing;
    const active = rows.find((row) => row.id === draft.id);
    const dirty = draft.id === null ? Boolean(draft.name.trim() || draft.text.trim()) : active !== undefined && (active.name !== draft.name || active.chars !== [...draft.text].length);
    const latex = draft.text.includes("\\documentclass");
    const suggestions = (review?.rewrites ?? []).filter((line) => !finished.has(line.source));

    const resetHistory = useCallback(() => {
        setPast([]);
        setFuture([]);
    }, []);

    const loadReview = useCallback(async (id: string | null) => {
        setReviewError(null);
        setFinished(new Set());
        setReview(id ? await getResumeReview(id).catch(() => null) : null);
    }, []);

    const load = useCallback(async () => {
        try {
            const list = await listResumes();
            setRows(list);
            if (list.length) {
                const full = await getResume(list[0].id);
                setDraft({ id: full.id, name: full.name, text: full.text });
            }
        } catch {
            setError("Could not load your resumes.");
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        void loadReview(draft.id);
    }, [draft.id, loadReview]);

    function remember(source?: string) {
        setPast((list) => [...list.slice(-(MAX_UNDO - 1)), { text: draft.text, source }]);
        setFuture([]);
    }

    function editText(text: string) {
        const now = Date.now();
        if (now - burst.current > BURST_MS) remember();
        burst.current = now;
        setDraft((current) => ({ ...current, text }));
    }

    function undo() {
        const last = past[past.length - 1];
        if (!last) return;
        setPast((list) => list.slice(0, -1));
        setFuture((list) => [...list.slice(-(MAX_UNDO - 1)), { text: draft.text, source: last.source }]);
        burst.current = 0;
        setDraft((current) => ({ ...current, text: last.text }));
        if (last.source) finish(last.source, false);
    }

    function redo() {
        const next = future[future.length - 1];
        if (!next) return;
        setFuture((list) => list.slice(0, -1));
        setPast((list) => [...list.slice(-(MAX_UNDO - 1)), { text: draft.text, source: next.source }]);
        burst.current = 0;
        setDraft((current) => ({ ...current, text: next.text }));
        if (next.source) finish(next.source, true);
    }

    function finish(source: string, done: boolean) {
        setFinished((set) => {
            if (set.has(source) === done) return set;
            const next = new Set(set);
            if (done) next.add(source);
            else next.delete(source);
            return next;
        });
    }

    useEffect(() => {
        function key(event: KeyboardEvent) {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
            if (!editing) return;
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
        }
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    });

    async function pick(file: File | undefined) {
        if (!file || busy) return;
        if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
            setError("That isn't a PDF. Drop a PDF, or paste it instead.");
            return;
        }
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const got = await extractResume(file);
            setDraft({ id: null, name: file.name.replace(/\.pdf$/i, "").slice(0, 80), text: got.text });
            setPasting(true);
            setImporting(false);
            resetHistory();
            setNotice(got.truncated ? `Read the first ${got.pages} pages. Check the text and fix anything missing. Not saved yet.` : "Read the PDF. Check the text, then Save. Not saved yet.");
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not import that PDF.");
        } finally {
            setBusy(false);
        }
    }

    async function save() {
        const name = draft.name.trim();
        if (!name || !draft.text.trim()) {
            setError("A resume needs a name and some text.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const saved = draft.id ? await updateResume(draft.id, { name, text: draft.text }) : await createResume({ name, text: draft.text });
            setRows((list) => (draft.id ? list.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...list]));
            setDraft({ id: saved.id, name: saved.name, text: saved.text });
            setPasting(false);
            setImporting(false);
            setNotice("Saved.");
            if (draft.id) await loadReview(saved.id);
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not save this resume.");
        } finally {
            setBusy(false);
        }
    }

    async function open(id: string) {
        if (draft.id === id) return;
        setError(null);
        setNotice(null);
        setImporting(false);
        setPasting(false);
        try {
            const full = await getResume(id);
            setDraft({ id: full.id, name: full.name, text: full.text });
            resetHistory();
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not open that resume.");
        }
    }

    function startNew() {
        setDraft(EMPTY);
        resetHistory();
        setPasting(false);
        setImporting(true);
        setError(null);
        setNotice(null);
    }

    function discard() {
        if (dirty && !confirm("Discard these unsaved changes?")) return;
        setDraft(EMPTY);
        resetHistory();
        setPasting(false);
        setImporting(false);
        setNotice(null);
        void load();
    }

    async function remove() {
        if (!draft.id || !confirm(`Delete "${draft.name}"?`)) return;
        setBusy(true);
        setError(null);
        try {
            await deleteResume(draft.id);
            const rest = rows.filter((row) => row.id !== draft.id);
            setRows(rest);
            setDraft(EMPTY);
            resetHistory();
            setPasting(false);
            setImporting(false);
            setNotice(null);
            if (rest.length) await open(rest[0].id);
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not delete that resume.");
        } finally {
            setBusy(false);
        }
    }

    async function reviewCurrent() {
        if (!draft.id) return;
        setReviewing(true);
        setReviewError(null);
        setFinished(new Set());
        try {
            setReview(await reviewResume(draft.id));
        } catch (problem) {
            setReviewError(problem instanceof ApiError ? problem.message : "Could not review this resume.");
        } finally {
            setReviewing(false);
        }
    }

    async function retryEdit(source: string) {
        if (!draft.id) return;
        setReviewError(null);
        try {
            setReview(await retryRewrite(draft.id, source));
        } catch (problem) {
            setReviewError(problem instanceof ApiError ? problem.message : "Could not retry that edit.");
        }
    }

    function applyRewrite(source: string, rewrite: string) {
        const next = replaceLine(draft.text, source, rewrite);
        if (next === null) return false;
        remember(source);
        burst.current = 0;
        setDraft((current) => ({ ...current, text: next }));
        return true;
    }

    function convertToLatex() {
        remember();
        burst.current = 0;
        setDraft((current) => ({ ...current, text: toLatex(current.text) }));
        setNotice(draft.id ? "Converted to LaTeX. Check the structure, then Save." : "Converted to LaTeX. Save it to see the preview.");
    }

    function focusLine(quote: string) {
        const at = offsetOf(draft.text, quote);
        const line = lineOf(draft.text, quote);
        if (at === null || line === null || !area.current) return;
        area.current.focus();
        area.current.setSelectionRange(at, at + quote.length);
        area.current.scrollTop = Math.max(0, (line - 3) * 18);
    }

    function updateProvider(next: Provider) {
        setProvider(next);
        saveProvider(next);
    }

    return (
        <main className="editor">
            <header className="editor-head">
                <h1>Resume</h1>
                <p className="hint">Single account, no login: every resume here is stored unencrypted in this deployment's database.</p>
            </header>

            {error && <p className="alert">{error}</p>}
            {notice && !error && <p className="note">{notice}</p>}

            {!editing && (
                <label className="dropzone">
                    <span>{busy ? "Reading the PDF..." : "Drop a PDF here, or click to browse"}</span>
                    <input
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={busy}
                        hidden
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            void pick(file);
                        }}
                    />
                    <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={(event) => {
                            event.preventDefault();
                            setPasting(true);
                        }}
                    >
                        Paste resume instead
                    </button>
                </label>
            )}

            {editing && (
                <section className="card">
                    <div className="chips">
                        {rows.map((row) => (
                            <button key={row.id} type="button" className={row.id === draft.id ? "chip on" : "chip"} onClick={() => void open(row.id)}>
                                {row.name}
                                <span className="chip-meta">{row.chars.toLocaleString()} chars</span>
                            </button>
                        ))}
                        {draft.id && (
                            <button type="button" className="chip new" onClick={startNew}>
                                + New
                            </button>
                        )}
                    </div>

                    <label className="field">
                        <span>Name</span>
                        <input value={draft.name} maxLength={80} placeholder="Title" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                    </label>

                    <div className="field-head">
                        <span>Resume text</span>
                        <span className="hint">
                            {dirty && (draft.id ? "Unsaved changes" : "Not saved")}
                            {!latex && draft.text.trim() !== "" && (
                                <button type="button" className="link" onClick={convertToLatex}>
                                    Convert to LaTeX
                                </button>
                            )}
                        </span>
                    </div>
                    <textarea ref={area} className="text" value={draft.text} placeholder="Paste your resume here..." onChange={(event) => editText(event.target.value)} />

                    <div className="actions">
                        <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()}>
                            {busy ? "Saving..." : draft.id ? "Save" : "Save resume"}
                        </button>
                        <button type="button" disabled={busy || past.length === 0} onClick={undo}>
                            Undo
                        </button>
                        <button type="button" disabled={busy || future.length === 0} onClick={redo}>
                            Redo
                        </button>
                        {draft.id ? (
                            <button type="button" disabled={busy} onClick={() => void remove()}>
                                Delete
                            </button>
                        ) : (
                            <button type="button" disabled={busy} onClick={discard}>
                                {dirty ? "Discard" : "Cancel"}
                            </button>
                        )}
                    </div>
                </section>
            )}

            {draft.id && !importing && (
                <div className={latex ? "panes two" : "panes"}>
                    <section className="card">
                        <details className="provider">
                            <summary>Reviewer provider</summary>
                            <p className="hint">Sent with each review request. The key stays in this browser tab.</p>
                            <input placeholder="Base URL, e.g. https://api.openai.com/v1" value={provider.baseUrl} onChange={(event) => updateProvider({ ...provider, baseUrl: event.target.value })} />
                            <input placeholder="Model" value={provider.model} onChange={(event) => updateProvider({ ...provider, model: event.target.value })} />
                            <input type="password" placeholder="API key" value={provider.key} onChange={(event) => updateProvider({ ...provider, key: event.target.value })} />
                        </details>

                        <div className="actions spread">
                            <h2>Review</h2>
                            {review && <span className="badge">{review.reads_at ? LEVEL_LABEL[review.reads_at] : "No band yet"}</span>}
                        </div>
                        <div className="actions">
                            <button type="button" className="primary" disabled={busy || dirty || reviewing || draft.id === null} onClick={() => void reviewCurrent()}>
                                {reviewing ? "Reviewing..." : review ? "Re-review" : "Review resume"}
                            </button>
                            {dirty && <span className="hint">Save before reviewing: the reviewer reads the saved text.</span>}
                        </div>
                        {reviewError && <p className="alert">{reviewError}</p>}

                        {review && (
                            <>
                                {review.stale && <p className="hint">Read the version before your last save. Re-review to match the page.</p>}
                                <p className="verdict">{review.verdict}</p>
                                <Ladder key={review.created_at} review={review} />
                                <h3>Rewrites</h3>
                                {suggestions.length === 0 && <p className="hint">No rewrites open. A re-review writes them again.</p>}
                                <ul className="edits">
                                    {suggestions.map((line) => (
                                        <li key={line.source}>
                                            <p className="was">{line.source}</p>
                                            <p className="now">{line.rewrite}</p>
                                            <div className="actions">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (applyRewrite(line.source, line.rewrite)) finish(line.source, true);
                                                    }}
                                                >
                                                    Apply
                                                </button>
                                                <button type="button" disabled={busy || review.stale} onClick={() => void retryEdit(line.source)}>
                                                    Retry
                                                </button>
                                                <button type="button" onClick={() => finish(line.source, true)}>
                                                    Dismiss
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                {review.lines.length > 0 && (
                                    <>
                                        <h3>Bullets</h3>
                                        <ul className="audits">
                                            {review.lines.map((line) => (
                                                <li key={`${line.call}:${line.text}`}>
                                                    <button type="button" onClick={() => focusLine(line.text)}>
                                                        <span className={`mark ${line.call}`}>{line.call}</span>
                                                        {line.text}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </>
                        )}
                    </section>

                    {latex && draft.id && <Preview text={draft.text} />}
                </div>
            )}
        </main>
    );
}

function Ladder({ review }: { review: ResumeReview }) {
    const [focus, setFocus] = useState<string | null>(null);
    const [all, setAll] = useState(false);
    const active = focus ?? review.reads_at ?? review.levels[0]?.level ?? null;
    const focused = review.levels.find((level) => level.level === active) ?? null;

    return (
        <>
            <div className="levels">
                {review.levels.map((level) => (
                    <button
                        key={level.level}
                        type="button"
                        aria-pressed={!all && level.level === active}
                        aria-label={`${LEVEL_LABEL[level.level] ?? level.level}: ${CALL_LABEL[level.call] ?? level.call}`}
                        className={!all && level.level === active ? `level ${level.call} on` : `level ${level.call}`}
                        onClick={() => {
                            setAll(false);
                            setFocus(level.level);
                        }}
                    >
                        {LEVEL_LABEL[level.level] ?? level.level}
                        <em>{CALL_LABEL[level.call] ?? level.call}</em>
                    </button>
                ))}
                <button type="button" className="link" onClick={() => setAll((value) => !value)}>
                    {all ? "One level" : "All levels"}
                </button>
            </div>
            {all ? (
                <div className="rungs">
                    {review.levels.map((level) => (
                        <Rung key={level.level} level={level} />
                    ))}
                </div>
            ) : (
                focused && <Rung level={focused} />
            )}
        </>
    );
}

function Rung({ level }: { level: ReviewLevel }) {
    return (
        <article className="rung">
            <header>
                <strong>{LEVEL_LABEL[level.level] ?? level.level}</strong>
                <span className={`level ${level.call}`}>{CALL_LABEL[level.call] ?? level.call}</span>
            </header>
            <p>{level.thinks}</p>
            {level.move && <p className="move">{level.move}</p>}
        </article>
    );
}

function Preview({ text }: { text: string }) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const current = useRef<string | null>(null);

    useEffect(() => {
        let alive = true;
        setBusy(true);
        const timer = window.setTimeout(async () => {
            try {
                const blob = await compileLatex(text);
                if (!alive) return;
                if (current.current) URL.revokeObjectURL(current.current);
                current.current = URL.createObjectURL(blob);
                setUrl(current.current);
                setError(null);
            } catch (problem) {
                if (!alive) return;
                setError(problem instanceof ApiError ? problem.message : "Could not compile this document.");
            } finally {
                if (alive) setBusy(false);
            }
        }, DEBOUNCE_MS);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [text]);

    useEffect(
        () => () => {
            if (current.current) URL.revokeObjectURL(current.current);
        },
        [],
    );

    return (
        <section className="card">
            <div className="actions spread">
                <h2>Preview</h2>
                <span className="hint">{busy ? "Compiling..." : error ? "Does not compile" : url ? "PDF" : "Waiting"}</span>
            </div>
            {error ? <pre className="log">{error}</pre> : url ? <iframe className="pdf" src={url} title="Resume preview" /> : null}
        </section>
    );
}
