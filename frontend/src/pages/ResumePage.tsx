import { type CSSProperties, Fragment, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "../components/CodeEditor";
import { PdfView } from "../components/PdfView";
import { ReviewPanel } from "../components/ReviewPanel";
import { ApiError, compileLatex, createResume, deleteResume, extractResume, getResume, getResumeReview, listResumes, loadProvider, type Provider, type ResumeReview, type ResumeSummary, retryRewrite, reviewResume, saveProvider, updateResume } from "../lib/api";
import { isLatex } from "../lib/latex";
import { replaceLine, type Suggestion } from "../lib/resumeText";
import { toLatex } from "../lib/toLatex";

interface Draft {
    id: string | null;
    name: string;
    text: string;
}

type Panel = "editor" | "pdf" | "review";

interface Layout {
    shown: Record<Panel, boolean>;
    widths: Record<Panel, number>;
}

const PANELS: Panel[] = ["editor", "pdf", "review"];
const PANEL_LABEL: Record<Panel, string> = { editor: "Editor", pdf: "PDF", review: "Review" };
const LAYOUT_KEY = "sesume.layout";
const SHOW_SHARE = 0.3;
const MIN_SHARE = 0.16;
const EMPTY: Draft = { id: null, name: "", text: "" };
const BURST_MS = 700;
const MAX_UNDO = 30;
const DEBOUNCE_MS = 900;

const DEFAULT_LAYOUT: Layout = {
    shown: { editor: true, pdf: true, review: true },
    widths: { editor: 0.44, pdf: 0.32, review: 0.24 },
};

interface UndoStep {
    text: string;
    source?: string;
}

function loadLayout(): Layout {
    try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        if (!raw) return DEFAULT_LAYOUT;
        const parsed = JSON.parse(raw) as Partial<Layout>;
        const shown = { ...DEFAULT_LAYOUT.shown };
        const widths = { ...DEFAULT_LAYOUT.widths };
        for (const panel of PANELS) {
            if (typeof parsed.shown?.[panel] === "boolean") shown[panel] = parsed.shown[panel];
            const width = parsed.widths?.[panel];
            if (typeof width === "number" && Number.isFinite(width) && width > 0) widths[panel] = width;
        }
        if (!PANELS.some((panel) => shown[panel])) return DEFAULT_LAYOUT;
        return { shown, widths };
    } catch {
        return DEFAULT_LAYOUT;
    }
}

function normalize(widths: Record<Panel, number>, shown: Record<Panel, boolean>): Record<Panel, number> {
    const visible = PANELS.filter((panel) => shown[panel]);
    const total = visible.reduce((sum, panel) => sum + widths[panel], 0) || 1;
    const next = { ...widths };
    for (const panel of visible) next[panel] = widths[panel] / total;
    return next;
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
    const [dropping, setDropping] = useState(false);
    const [focus, setFocus] = useState<{ quote: string; n: number } | null>(null);
    const [hover, setHover] = useState<Suggestion | null>(null);
    const [provider, setProvider] = useState<Provider>(() => loadProvider());
    const [layout, setLayout] = useState<Layout>(loadLayout);
    const burst = useRef(0);
    const columns = useRef<HTMLDivElement>(null);

    const editing = draft.id !== null || pasting || importing;
    const active = rows.find((row) => row.id === draft.id);
    const dirty = draft.id === null ? Boolean(draft.name.trim() || draft.text.trim()) : active !== undefined && (active.name !== draft.name || active.chars !== [...draft.text].length);
    const latex = isLatex(draft.text);
    const suggestions = useMemo(() => (review?.rewrites ?? []).filter((line) => !finished.has(line.source)), [review, finished]);
    const visible = PANELS.filter((panel) => layout.shown[panel]);
    const mass = visible.reduce((sum, panel) => sum + layout.widths[panel], 0) || 1;
    const share = (panel: Panel) => (layout.widths[panel] / mass) * 100;

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
            } catch {
                return;
            }
        }, 150);
        return () => window.clearTimeout(timer);
    }, [layout]);

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

    function togglePanel(panel: Panel) {
        setLayout((current) => {
            const showing = !current.shown[panel];
            const shown = { ...current.shown, [panel]: showing };
            if (!PANELS.some((next) => shown[next])) return current;
            const widths = { ...current.widths };
            if (showing) {
                for (const next of PANELS) if (next !== panel && current.shown[next]) widths[next] *= 1 - SHOW_SHARE;
                widths[panel] = SHOW_SHARE;
            }
            return { shown, widths: normalize(widths, shown) };
        });
    }

    function startResize(event: PointerEvent<HTMLDivElement>, left: Panel, right: Panel) {
        event.preventDefault();
        const rect = columns.current?.getBoundingClientRect();
        if (!rect) return;
        const startX = event.clientX;
        const start = { ...layout.widths };
        const pair = start[left] + start[right];
        const floor = Math.min(MIN_SHARE * mass, pair / 2);

        const move = (next: globalThis.PointerEvent) => {
            const delta = ((next.clientX - startX) / rect.width) * mass;
            const at = Math.min(pair - floor, Math.max(floor, start[left] + delta));
            setLayout((current) => ({ ...current, widths: { ...current.widths, [left]: at, [right]: pair - at } }));
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            document.body.classList.remove("resizing");
        };
        document.body.classList.add("resizing");
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    }

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
        setHover(null);
        setDraft((current) => ({ ...current, text: last.text }));
        if (last.source) finish(last.source, false);
    }

    function redo() {
        const next = future[future.length - 1];
        if (!next) return;
        setFuture((list) => list.slice(0, -1));
        setPast((list) => [...list.slice(-(MAX_UNDO - 1)), { text: draft.text, source: next.source }]);
        burst.current = 0;
        setHover(null);
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
            if (!editing || (event.target as HTMLElement | null)?.tagName === "INPUT") return;
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
        setHover(null);
        setDraft((current) => ({ ...current, text: next }));
        return true;
    }

    function convertToLatex() {
        remember();
        burst.current = 0;
        setHover(null);
        setDraft((current) => ({ ...current, text: toLatex(current.text) }));
        setNotice(draft.id ? "Converted to LaTeX. Check the structure, then Save." : "Converted to LaTeX. Save it to see the preview.");
    }

    function updateProvider(next: Provider) {
        setProvider(next);
        saveProvider(next);
    }

    return (
        <div className="studio">
            <header className="bar">
                <span className="brand">sesume</span>
                <div className="chips">
                    {rows.map((row) => (
                        <button key={row.id} type="button" className={row.id === draft.id ? "chip on" : "chip"} onClick={() => void open(row.id)}>
                            {row.name}
                        </button>
                    ))}
                    {draft.id && (
                        <button type="button" className="chip new" onClick={startNew}>
                            + New
                        </button>
                    )}
                </div>
                {editing && (
                    <div className="actions toggles">
                        {PANELS.map((panel) => (
                            <button key={panel} type="button" className={layout.shown[panel] ? "toggle on" : "toggle"} aria-pressed={layout.shown[panel]} onClick={() => togglePanel(panel)}>
                                {PANEL_LABEL[panel]}
                            </button>
                        ))}
                    </div>
                )}
                <span className="state">{dirty ? (draft.id ? "Unsaved changes" : "Not saved") : draft.id ? "Saved" : ""}</span>
                <div className="actions end">
                    {draft.id ? (
                        <button type="button" disabled={busy} onClick={() => void remove()}>
                            Delete
                        </button>
                    ) : (
                        editing && (
                            <button type="button" disabled={busy} onClick={discard}>
                                {dirty ? "Discard" : "Cancel"}
                            </button>
                        )
                    )}
                    <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()}>
                        {busy ? "Saving..." : "Save"}
                    </button>
                </div>
            </header>

            {(error || notice) && <div className="banner">{error ? <p className="alert">{error}</p> : <p className="note">{notice}</p>}</div>}

            {editing ? (
                <div className="columns" ref={columns}>
                    {visible.map((panel, index) => (
                        <Fragment key={panel}>
                            {index > 0 && <div className="splitter" aria-hidden="true" onPointerDown={(event) => startResize(event, visible[index - 1], panel)} />}
                            <section className="pane" style={{ "--share": `${share(panel)}%` } as CSSProperties}>
                                {panel === "editor" && (
                                    <>
                                        <div className="pane-bar">
                                            <input className="name" value={draft.name} maxLength={80} placeholder="Resume name" aria-label="Resume name" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                                            <div className="actions">
                                                {!latex && draft.text.trim() !== "" && (
                                                    <button type="button" className="link" onClick={convertToLatex}>
                                                        Convert to LaTeX
                                                    </button>
                                                )}
                                                <button type="button" disabled={busy || past.length === 0} onClick={undo}>
                                                    Undo
                                                </button>
                                                <button type="button" disabled={busy || future.length === 0} onClick={redo}>
                                                    Redo
                                                </button>
                                            </div>
                                        </div>
                                        <CodeEditor value={draft.text} latex={latex} marks={review?.lines ?? []} suggestions={suggestions} ghost={hover} focus={focus} placeholder="Paste your resume here..." onChange={editText} />
                                    </>
                                )}
                                {panel === "pdf" && (latex ? <Preview text={draft.text} /> : <p className="hint pad">Convert the text to LaTeX to see the preview.</p>)}
                                {panel === "review" && (
                                    <div className="pane-body">
                                        <ReviewPanel
                                            review={review}
                                            busy={reviewing}
                                            error={reviewError}
                                            dirty={dirty}
                                            saved={draft.id !== null}
                                            provider={provider}
                                            onProvider={updateProvider}
                                            onReview={() => void reviewCurrent()}
                                            onApply={applyRewrite}
                                            onRetry={(source) => void retryEdit(source)}
                                            onDismiss={(source) => finish(source, true)}
                                            onFocusLine={(quote) => setFocus((current) => ({ quote, n: (current?.n ?? 0) + 1 }))}
                                            onHover={setHover}
                                            suggestions={suggestions}
                                        />
                                    </div>
                                )}
                            </section>
                        </Fragment>
                    ))}
                </div>
            ) : (
                <main className="welcome">
                    <label
                        className={dropping ? "dropzone dropping" : "dropzone"}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDropping(true);
                        }}
                        onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDropping(false);
                            void pick(event.dataTransfer.files?.[0]);
                        }}
                    >
                        <span className="dropzone-title">{dropping ? "Drop it" : busy ? "Reading the PDF..." : "Drop a PDF here, or click to browse"}</span>
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
                    <p className="hint pad">Single account, no login: every resume here is stored unencrypted in this deployment's database.</p>
                </main>
            )}
        </div>
    );
}

function Preview({ text }: { text: string }) {
    const [pdf, setPdf] = useState<Uint8Array | null>(null);
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
                setPdf(new Uint8Array(await blob.arrayBuffer()));
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
        <>
            <div className="pane-bar">
                <span className="hint">{busy ? "Compiling..." : error ? "Does not compile" : pdf ? "PDF" : "Waiting"}</span>
                {url && !error && (
                    <a className="link end" href={url} target="_blank" rel="noreferrer">
                        Open
                    </a>
                )}
            </div>
            <div className="pane-body fill">{error ? <pre className="log">{error}</pre> : pdf ? <PdfView data={pdf} /> : null}</div>
        </>
    );
}
