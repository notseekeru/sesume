import { type CSSProperties, Fragment, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CodeEditor } from "../components/CodeEditor";
import { Logo } from "../components/Logo";
import { PdfView } from "../components/PdfView";
import { ReviewPanel } from "../components/ReviewPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError, compileLatex, createResume, deleteResume, extractResume, getResume, getResumeReview, listResumes, loadProvider, logout, type Provider, type ResumeReview, type ResumeSummary, retryRewrite, reviewResume, saveProvider, updateResume } from "../lib/api";
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
const ZOOM_FIT = 100;
const ZOOM_MIN = 25;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

function clampZoom(percent: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, percent));
}

const DEFAULT_LAYOUT: Layout = {
    shown: { editor: true, pdf: true, review: true },
    widths: { editor: 0.42, pdf: 0.3, review: 0.28 },
};

const COMPACT_QUERY = "(max-width: 900px)";

type ShortcutEvent = { metaKey: boolean; ctrlKey: boolean; key: string; shiftKey: boolean };
type ShortcutIntent = { action: "save" | "undo" | "redo" | null; prevent: boolean };

function shortcut(event: ShortcutEvent, showEditor: boolean, dirty: boolean, busy: boolean): ShortcutIntent {
    if (!(event.metaKey || event.ctrlKey)) return { action: null, prevent: false };
    const pressed = event.key.toLowerCase();
    if (pressed === "s") return { action: dirty && !busy ? "save" : null, prevent: true };
    if (!showEditor || pressed !== "z") return { action: null, prevent: false };
    return { action: event.shiftKey ? "redo" : "undo", prevent: true };
}

if (import.meta.env.DEV) {
    const press = (init: Partial<ShortcutEvent>): ShortcutEvent => ({ metaKey: false, ctrlKey: false, key: "", shiftKey: false, ...init });
    const checks = [
        shortcut(press({ ctrlKey: true, key: "s" }), true, true, false).action === "save",
        shortcut(press({ ctrlKey: true, key: "s" }), false, true, false).action === "save",
        shortcut(press({ metaKey: true, key: "s" }), true, false, false).action === null,
        shortcut(press({ ctrlKey: true, key: "s" }), true, false, false).prevent,
        shortcut(press({ ctrlKey: true, key: "z" }), true, false, false).action === "undo",
        shortcut(press({ ctrlKey: true, key: "Z", shiftKey: true }), true, false, false).action === "redo",
        shortcut(press({ ctrlKey: true, key: "z" }), false, false, false).prevent === false,
        clampZoom(ZOOM_MIN - ZOOM_STEP) === ZOOM_MIN,
        clampZoom(ZOOM_MAX + ZOOM_STEP) === ZOOM_MAX,
        clampZoom(ZOOM_FIT) === ZOOM_FIT,
    ];
    if (checks.includes(false)) console.error("self-check failed");
}

interface UndoStep {
    text: string;
    source?: string;
}

function useCompact(): boolean {
    const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
    useEffect(() => {
        const query = window.matchMedia(COMPACT_QUERY);
        const sync = () => setCompact(query.matches);
        query.addEventListener("change", sync);
        return () => query.removeEventListener("change", sync);
    }, []);
    return compact;
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

export default function ResumePage({ email, offline, onRetry }: { email: string | null; offline: boolean; onRetry: () => void }) {
    const [rows, setRows] = useState<ResumeSummary[]>([]);
    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [saved, setSaved] = useState<{ name: string; text: string } | null>(null);
    const [review, setReview] = useState<ResumeReview | null>(null);
    const [past, setPast] = useState<UndoStep[]>([]);
    const [future, setFuture] = useState<UndoStep[]>([]);
    const [finished, setFinished] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [reviewing, setReviewing] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const [pasting, setPasting] = useState(false);
    const [dropping, setDropping] = useState(false);
    const [focus, setFocus] = useState<{ quote: string; n: number } | null>(null);
    const [hover, setHover] = useState<Suggestion | null>(null);
    const [provider, setProvider] = useState<Provider>(() => loadProvider());
    const [layout, setLayout] = useState<Layout>(loadLayout);
    // AI HERE: compact mode reuses the pane toggles as tabs and keeps the choice in memory, not storage. Upgrade path: persist the mobile pane.
    const [tab, setTab] = useState<Panel>(() => PANELS.find((panel) => layout.shown[panel]) ?? "editor");
    const compact = useCompact();
    const burst = useRef(0);
    const columns = useRef<HTMLDivElement>(null);
    const draftRef = useRef<Draft>(EMPTY);
    draftRef.current = draft;

    const dirty = draft.id === null ? Boolean(draft.name.trim() || draft.text.trim()) : saved !== null && (draft.name !== saved.name || draft.text !== saved.text);
    const latex = isLatex(draft.text);
    const suggestions = useMemo(() => (review?.rewrites ?? []).filter((line) => !finished.has(line.source)), [review, finished]);
    const visible = compact ? [tab] : PANELS.filter((panel) => layout.shown[panel]);
    const showEditor = visible.includes("editor");
    const empty = !pasting && draft.text.trim() === "";
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
        if (offline) return;
        try {
            const list = await listResumes();
            setError(null);
            setRows(list);
            const idle = draftRef.current.id === null && draftRef.current.text === "";
            if (list.length && idle) {
                const full = await getResume(list[0].id);
                setDraft({ id: full.id, name: full.name, text: full.text });
                setSaved({ name: full.name, text: full.text });
            } else if (!list.length) {
                setSaved(null);
            }
        } catch (problem) {
            if (!(problem instanceof ApiError && problem.status === 401)) setError("Could not load your resumes.");
        }
    }, [offline]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        void loadReview(draft.id);
    }, [draft.id, loadReview]);

    function togglePanel(panel: Panel) {
        if (compact) {
            setTab(panel);
            return;
        }
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
            const { action, prevent } = shortcut(event, showEditor, dirty, busy);
            if (!prevent) return;
            if ((action === "undo" || action === "redo") && (event.target as HTMLElement | null)?.tagName === "INPUT") return;
            event.preventDefault();
            if (action === "save") void save();
            else if (action === "redo") redo();
            else if (action === "undo") undo();
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
            setSaved(null);
            setPasting(true);
            resetHistory();
            setNotice(got.truncated ? `Read the first ${got.pages} pages. Check the text and fix anything missing. Not saved yet.` : "Read the PDF. Check the text, then Save. Not saved yet.");
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not import that PDF.");
        } finally {
            setBusy(false);
        }
    }

    async function save() {
        const name = draft.name.trim() || "Untitled resume";
        if (!draft.text.trim()) {
            setError("A resume needs some text.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const saved = draft.id ? await updateResume(draft.id, { name, text: draft.text }) : await createResume({ name, text: draft.text });
            setRows((list) => (draft.id ? list.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...list]));
            setDraft({ id: saved.id, name: saved.name, text: saved.text });
            setSaved({ name: saved.name, text: saved.text });
            setPasting(false);
            setNotice(null);
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
        setPasting(false);
        try {
            const full = await getResume(id);
            setDraft({ id: full.id, name: full.name, text: full.text });
            setSaved({ name: full.name, text: full.text });
            resetHistory();
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not open that resume.");
        }
    }

    function startNew() {
        setDraft(EMPTY);
        setSaved(null);
        resetHistory();
        setPasting(false);
        setError(null);
        setNotice(null);
    }

    function discard() {
        if (dirty && !confirm("Discard these unsaved changes?")) return;
        setDraft(EMPTY);
        draftRef.current = EMPTY;
        setSaved(null);
        resetHistory();
        setPasting(false);
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
            setSaved(null);
            resetHistory();
            setPasting(false);
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
        setNotice("Converted to LaTeX. Check the structure, then Save.");
    }

    function updateProvider(next: Provider) {
        setProvider(next);
        saveProvider(next);
    }

    const signOut = async () => {
        await logout().catch(() => undefined);
        window.location.assign("/");
    };

    return (
        <div className="studio">
            <header className="masthead">
                <div className="brand">
                    <Logo />
                    <span className="brand-name">sesume</span>
                </div>
                <nav className="tabs" aria-label="Resumes">
                    {rows.map((row) => (
                        <button key={row.id} type="button" className={row.id === draft.id ? "tab on" : "tab"} onClick={() => void open(row.id)}>
                            {row.name}
                        </button>
                    ))}
                    {draft.id && (
                        <button type="button" className="tab new" onClick={startNew}>
                            + New
                        </button>
                    )}
                </nav>
                <fieldset className="seg" aria-label="Panes">
                    <legend className="sr">Panes</legend>
                    {PANELS.map((panel) => {
                        const on = compact ? tab === panel : layout.shown[panel];
                        return (
                            <button key={panel} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => togglePanel(panel)}>
                                {PANEL_LABEL[panel]}
                            </button>
                        );
                    })}
                </fieldset>
                <div className="actions">
                    <ThemeToggle />
                    {email ? (
                        <button type="button" className="btn quiet" title={email} onClick={() => void signOut()}>
                            Sign out
                        </button>
                    ) : (
                        <Link className="btn" to="/login">
                            Sign in
                        </Link>
                    )}
                    {draft.id ? (
                        <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
                            Delete
                        </button>
                    ) : (
                        <button type="button" className="btn discard" disabled={busy} onClick={discard}>
                            {dirty ? "Discard" : "Cancel"}
                        </button>
                    )}
                    {!showEditor && (
                        <button type="button" className="btn primary save" disabled={busy || !dirty} title="Save (Ctrl/Cmd+S)" aria-keyshortcuts="Control+S Meta+S" onClick={() => void save()}>
                            {busy ? "Saving..." : "Save"}
                        </button>
                    )}
                </div>
            </header>

            {offline && (
                <p className="hint" role="alert">
                    Cannot reach the server. Nothing saved has been lost.{" "}
                    <button type="button" className="btn link" onClick={onRetry}>
                        Retry
                    </button>
                </p>
            )}

            {(error || notice) && !offline && (
                <p className="hint" role={error ? "alert" : "status"}>
                    {error ?? notice}
                </p>
            )}

            <div className="columns" ref={columns}>
                {visible.map((panel, index) => (
                    <Fragment key={panel}>
                        {index > 0 && <div className="splitter" aria-hidden="true" onPointerDown={(event) => startResize(event, visible[index - 1], panel)} />}
                        <section className="pane" style={{ "--share": `${share(panel)}%` } as CSSProperties}>
                            {panel === "editor" && (
                                <>
                                    <div className="pane-bar">
                                        <input className="name" value={draft.name} maxLength={80} placeholder="Untitled resume" aria-label="Resume name" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                                        <div className="actions">
                                            {!latex && draft.text.trim() !== "" && (
                                                <button type="button" className="btn quiet" onClick={convertToLatex}>
                                                    Convert to LaTeX
                                                </button>
                                            )}
                                            <button type="button" className="btn quiet" disabled={busy || past.length === 0} title="Undo (Ctrl/Cmd+Z)" aria-keyshortcuts="Control+Z Meta+Z" onClick={undo}>
                                                Undo
                                            </button>
                                            <button type="button" className="btn quiet" disabled={busy || future.length === 0} title="Redo (Ctrl/Cmd+Shift+Z)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" onClick={redo}>
                                                Redo
                                            </button>
                                            <button type="button" className="btn primary save" disabled={busy || !dirty} title="Save (Ctrl/Cmd+S)" aria-keyshortcuts="Control+S Meta+S" onClick={() => void save()}>
                                                {busy ? "Saving..." : "Save"}
                                            </button>
                                        </div>
                                    </div>
                                    {empty ? (
                                        <div className="pane-body pane-empty">
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
                                                <span className="dropzone-title">{dropping ? "Drop it" : busy ? "Reading the PDF..." : "Drop PDF"}</span>
                                                <input
                                                    type="file"
                                                    className="sr"
                                                    accept="application/pdf,.pdf"
                                                    disabled={busy}
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        event.target.value = "";
                                                        void pick(file);
                                                    }}
                                                />
                                            </label>
                                            <button type="button" className="btn link paste" disabled={busy} onClick={() => setPasting(true)}>
                                                Paste resume instead
                                            </button>
                                        </div>
                                    ) : (
                                        <CodeEditor value={draft.text} latex={latex} marks={review?.lines ?? []} suggestions={suggestions} ghost={hover} focus={focus} placeholder="Paste your resume here..." onChange={editText} />
                                    )}
                                </>
                            )}
                            {panel === "pdf" &&
                                (saved && isLatex(saved.text) ? (
                                    <Preview key={draft.id ?? "new"} text={saved.text} stale={dirty} />
                                ) : (
                                    <>
                                        <div className="pane-bar pane-bar-plain">
                                            <span className="pane-label">Preview</span>
                                        </div>
                                        <p className="hint pad">{latex ? "Save to see the preview." : "Convert the text to LaTeX to see the preview."}</p>
                                    </>
                                ))}
                            {panel === "review" && (
                                <>
                                    <div className="pane-bar pane-bar-plain">
                                        <span className="pane-label">Review</span>
                                    </div>
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
                                </>
                            )}
                        </section>
                    </Fragment>
                ))}
            </div>
        </div>
    );
}

function Preview({ text, stale }: { text: string; stale: boolean }) {
    const [pdf, setPdf] = useState<Uint8Array | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [zoom, setZoom] = useState(ZOOM_FIT);
    const current = useRef<string | null>(null);
    const latest = useRef(0);
    const zoomBy = useCallback((dir: number) => setZoom((percent) => clampZoom(percent + dir * ZOOM_STEP)), []);
    const fit = useCallback(() => setZoom(ZOOM_FIT), []);

    useEffect(() => {
        const id = ++latest.current;
        setBusy(true);
        setError(null);
        void (async () => {
            try {
                const blob = await compileLatex(text);
                const bytes = new Uint8Array(await blob.arrayBuffer());
                if (id !== latest.current) return;
                if (current.current) URL.revokeObjectURL(current.current);
                current.current = URL.createObjectURL(blob);
                setUrl(current.current);
                setPdf(bytes);
            } catch (problem) {
                if (id !== latest.current) return;
                setError(problem instanceof ApiError ? problem.message : "Could not compile this document.");
            } finally {
                if (id === latest.current) setBusy(false);
            }
        })();
    }, [text]);

    useEffect(
        () => () => {
            latest.current += 1;
            if (current.current) URL.revokeObjectURL(current.current);
        },
        [],
    );

    return (
        <>
            <div className="pane-bar">
                <span className="pane-label">Preview</span>
                <div className="zoom">
                    <button type="button" className="btn quiet" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => zoomBy(-1)}>
                        -
                    </button>
                    <button type="button" className="btn quiet fit" aria-label={`Zoom ${zoom}%, fit to width`} onClick={fit}>
                        {zoom}%
                    </button>
                    <button type="button" className="btn quiet" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => zoomBy(1)}>
                        +
                    </button>
                </div>
                {(busy || error || !pdf || stale) && (
                    <span className="state" aria-live="polite">
                        {busy ? "Compiling..." : error ? "Does not compile" : stale ? "Saved version" : "Waiting"}
                    </span>
                )}
                {url && !error && (
                    <a className="btn quiet end" href={url} target="_blank" rel="noreferrer">
                        Open
                    </a>
                )}
            </div>
            <div className="pane-body fill">{error ? <pre className="log">{error}</pre> : pdf ? <PdfView data={pdf} zoom={zoom} onZoom={zoomBy} onReset={fit} /> : null}</div>
        </>
    );
}
