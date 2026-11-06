import { useState } from "react";
import type { Provider, ResumeReview, ReviewLevel } from "../lib/api";
import type { Suggestion } from "../lib/resumeText";

const LEVEL_LABEL: Record<string, string> = { intern: "Intern", junior: "Junior", mid: "Mid-level", senior: "Senior", staff: "Staff", principal: "Principal" };
const CALL_LABEL: Record<string, string> = { passes: "Passes", close: "Close", fails: "Fails" };

export interface ReviewPanelProps {
    review: ResumeReview | null;
    busy: boolean;
    error: string | null;
    dirty: boolean;
    saved: boolean;
    provider: Provider;
    onProvider: (provider: Provider) => void;
    onReview: () => void;
    onApply: (source: string, rewrite: string) => boolean;
    onRetry: (source: string) => void;
    onDismiss: (source: string) => void;
    onFocusLine: (text: string) => void;
    onHover: (hover: Suggestion | null) => void;
    suggestions: Suggestion[];
}

export function ReviewPanel({ review, busy, error, dirty, saved, provider, onProvider, onReview, onApply, onRetry, onDismiss, onFocusLine, onHover, suggestions }: ReviewPanelProps) {
    const open = suggestions;

    return (
        <div className="review">
            <div className="actions">
                <button type="button" className="btn primary" disabled={!saved || busy || dirty} onClick={onReview}>
                    {busy ? "Reviewing..." : review ? "Re-review" : "Review resume"}
                </button>
            </div>

            {error && (
                <p className="hint" role="alert">
                    {error}
                </p>
            )}

            {review === null ? (
                <div className="empty">
                    <p className="hint">No review yet.</p>
                </div>
            ) : (
                <>
                    {review.stale && <p className="hint">Read the version before your last save. Re-review to match the page.</p>}
                    <p className="verdict">{review.verdict}</p>
                    <Ladder key={review.created_at} review={review} />

                    <section className="block">
                        <h3>Rewrites</h3>
                        {open.length === 0 ? (
                            <p className="hint">No rewrites open.</p>
                        ) : (
                            <ul className="edits">
                                {open.map((line) => (
                                    <li
                                        key={line.source}
                                        onMouseEnter={() => onHover(line)}
                                        onMouseLeave={() => onHover(null)}
                                        onFocus={() => onHover(line)}
                                        onBlur={(event) => {
                                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHover(null);
                                        }}
                                    >
                                        <p className="was">{line.source}</p>
                                        <p className="now">{line.rewrite}</p>
                                        <div className="actions">
                                            <button
                                                type="button"
                                                className="btn primary"
                                                disabled={busy}
                                                onClick={() => {
                                                    if (onApply(line.source, line.rewrite)) onDismiss(line.source);
                                                }}
                                            >
                                                Apply
                                            </button>
                                            <button type="button" className="btn" disabled={busy || review.stale} onClick={() => onRetry(line.source)}>
                                                Retry
                                            </button>
                                            <button type="button" className="btn quiet" onClick={() => onDismiss(line.source)}>
                                                Dismiss
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {review.lines.length > 0 && (
                        <section className="block">
                            <h3>Bullets</h3>
                            <ul className="audits">
                                {review.lines.map((line) => (
                                    <li key={`${line.call}:${line.text}`}>
                                        <button type="button" onClick={() => onFocusLine(line.text)}>
                                            <span className={`mark ${line.call}`}>{line.call}</span>
                                            {line.text}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </>
            )}

            <details className="provider">
                <summary>Reviewer provider</summary>
                <p className="hint">The key stays in this browser tab.</p>
                <input className="field" aria-label="Base URL" placeholder="Base URL, e.g. https://api.openai.com/v1" value={provider.baseUrl} onChange={(event) => onProvider({ ...provider, baseUrl: event.target.value })} />
                <input className="field" aria-label="Model" placeholder="Model" value={provider.model} onChange={(event) => onProvider({ ...provider, model: event.target.value })} />
                <input className="field" type="password" aria-label="API key" placeholder="API key" value={provider.key} onChange={(event) => onProvider({ ...provider, key: event.target.value })} />
            </details>
        </div>
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
                        <span className={`dot ${level.call}`} aria-hidden />
                        {LEVEL_LABEL[level.level] ?? level.level}
                        <em>{CALL_LABEL[level.call] ?? level.call}</em>
                    </button>
                ))}
                <button type="button" className="btn link" onClick={() => setAll((value) => !value)}>
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
                <span className={`level ${level.call}`}>
                    <span className={`dot ${level.call}`} aria-hidden />
                    {CALL_LABEL[level.call] ?? level.call}
                </span>
            </header>
            <p>{level.thinks}</p>
            {level.move && <p className="move">{level.move}</p>}
        </article>
    );
}
