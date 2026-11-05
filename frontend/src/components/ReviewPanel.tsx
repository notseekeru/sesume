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
            <div className="review-head">
                <div className="actions">
                    <button type="button" className="primary" disabled={!saved || busy || dirty} onClick={onReview}>
                        {busy ? "Reviewing..." : review ? "Re-review" : "Review resume"}
                    </button>
                    {dirty && saved && <span className="hint">Save before reviewing: the reviewer reads the saved text.</span>}
                </div>
                {review && <span className="badge">{review.reads_at ? LEVEL_LABEL[review.reads_at] : "No band yet"}</span>}
            </div>

            {error && <p className="alert">{error}</p>}

            {review === null ? (
                <p className="hint pad">No review yet. One review grades the page against every band, names the sections and writes the edits that raise it.</p>
            ) : (
                <>
                    {review.stale && <p className="hint">Read the version before your last save. Re-review to match the page.</p>}
                    <p className="verdict">{review.verdict}</p>
                    <Ladder key={review.created_at} review={review} />

                    <h3>Rewrites</h3>
                    {open.length === 0 ? (
                        <p className="hint">No rewrites open. A re-review writes them again.</p>
                    ) : (
                        <ul className="edits">
                            {open.map((line) => (
                                <li key={line.source} onMouseEnter={() => onHover(line)} onMouseLeave={() => onHover(null)}>
                                    <p className="was">{line.source}</p>
                                    <p className="now">{line.rewrite}</p>
                                    <div className="actions">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => {
                                                if (onApply(line.source, line.rewrite)) onDismiss(line.source);
                                            }}
                                        >
                                            Apply
                                        </button>
                                        <button type="button" disabled={busy || review.stale} onClick={() => onRetry(line.source)}>
                                            Retry
                                        </button>
                                        <button type="button" onClick={() => onDismiss(line.source)}>
                                            Dismiss
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    {review.lines.length > 0 && (
                        <>
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
                        </>
                    )}
                </>
            )}

            <details className="provider">
                <summary>Reviewer provider</summary>
                <p className="hint">Sent with each review request. The key stays in this browser tab.</p>
                <input placeholder="Base URL, e.g. https://api.openai.com/v1" value={provider.baseUrl} onChange={(event) => onProvider({ ...provider, baseUrl: event.target.value })} />
                <input placeholder="Model" value={provider.model} onChange={(event) => onProvider({ ...provider, model: event.target.value })} />
                <input type="password" placeholder="API key" value={provider.key} onChange={(event) => onProvider({ ...provider, key: event.target.value })} />
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
