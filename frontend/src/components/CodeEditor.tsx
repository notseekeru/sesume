import { type MouseEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tokenize } from "../lib/latex";
import { callByLine, type LineCall, lineOf, type Suggestion } from "../lib/resumeText";

const LINE_HEIGHT = 20;
const PAD_TOP = 12;

export interface CodeEditorProps {
    value: string;
    latex: boolean;
    marks: { text: string; call: LineCall }[];
    suggestions: Suggestion[];
    ghost: Suggestion | null;
    focus: { quote: string; n: number } | null;
    placeholder: string;
    onChange: (value: string) => void;
}

export function CodeEditor({ value, latex, marks, suggestions, ghost, focus, placeholder, onChange }: CodeEditorProps) {
    const layer = useRef<HTMLPreElement>(null);
    const area = useRef<HTMLTextAreaElement>(null);
    const gutter = useRef<HTMLDivElement>(null);
    const seen = useRef(0);
    const rows = useMemo(() => value.split("\n"), [value]);
    const calls = useMemo(() => callByLine(value, marks), [value, marks]);
    const byLine = useMemo(() => {
        const map = new Map<number, Suggestion>();
        for (const item of suggestions) {
            const line = lineOf(value, item.source);
            if (line !== null && !map.has(line)) map.set(line, item);
        }
        return map;
    }, [suggestions, value]);
    const [over, setOver] = useState<number | null>(null);
    const ghostLine = useMemo(() => (ghost ? lineOf(value, ghost.source) : null), [ghost, value]);
    const hinted = over === null ? null : (byLine.get(over) ?? null);
    const shown = ghost ?? hinted;
    const shownLine = ghost ? ghostLine : over === null ? null : hinted ? over : null;

    const sync = useCallback((node: HTMLTextAreaElement) => {
        if (layer.current) {
            layer.current.scrollTop = node.scrollTop;
            layer.current.scrollLeft = node.scrollLeft;
        }
        if (gutter.current) gutter.current.style.transform = `translateY(${-node.scrollTop}px)`;
        node.parentElement?.style.setProperty("--scroll", `${node.scrollTop}px`);
    }, []);

    useLayoutEffect(() => {
        const bump = focus?.n ?? 0;
        const node = area.current;
        if (!focus || !node || seen.current === bump) return;
        seen.current = bump;
        const line = lineOf(value, focus.quote);
        if (line === null) return;
        const at = rows.slice(0, line).reduce((sum, row) => sum + row.length + 1, 0);
        node.focus();
        node.setSelectionRange(at, at + (rows[line]?.length ?? 0));
        node.scrollTop = Math.max(0, PAD_TOP + line * LINE_HEIGHT - LINE_HEIGHT * 3);
        sync(node);
    }, [focus, rows, value, sync]);

    useLayoutEffect(() => {
        const node = area.current;
        if (ghostLine === null || !node) return;
        const top = PAD_TOP + ghostLine * LINE_HEIGHT;
        if (top < node.scrollTop || top + LINE_HEIGHT > node.scrollTop + node.clientHeight - LINE_HEIGHT * 3) {
            node.scrollTop = Math.max(0, top - LINE_HEIGHT * 3);
            sync(node);
        }
    }, [ghostLine, sync]);

    function lineAt(event: MouseEvent<HTMLTextAreaElement>): number {
        const node = event.currentTarget;
        const offset = event.clientY - node.getBoundingClientRect().top + node.scrollTop - PAD_TOP;
        return Math.max(0, Math.min(rows.length - 1, Math.floor(offset / LINE_HEIGHT)));
    }

    return (
        <div className="editor">
            <div className="gutter" aria-hidden>
                <div ref={gutter} className="gutter-inner">
                    {rows.map((row, index) => {
                        const call = calls.get(index);
                        const touched = shownLine === index;
                        return (
                            <div key={`${index}:${row}`} className={`no${call ? ` ${call}` : ""}${touched ? " touched" : ""}`}>
                                {index + 1}
                            </div>
                        );
                    })}
                </div>
            </div>
            <pre ref={layer} className="layer" aria-hidden>
                {rows.map((row, index) => {
                    const call = calls.get(index);
                    const touched = shownLine === index;
                    return (
                        <span key={`${index}:${row}`} className={`line${call ? ` ${call}` : ""}${touched ? " touched" : ""}`}>
                            {latex
                                ? tokenize(row).map((token, at) => (
                                      <span key={`${at}:${token.text}`} className={`tok-${token.kind}`}>
                                          {token.text}
                                      </span>
                                  ))
                                : row}
                            {"\n"}
                        </span>
                    );
                })}
            </pre>
            <textarea
                ref={area}
                className="input"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onScroll={(event) => sync(event.currentTarget)}
                onMouseMove={(event) => setOver(lineAt(event))}
                onMouseLeave={() => setOver(null)}
                spellCheck={false}
                wrap="off"
                placeholder={placeholder}
                aria-label="Resume source"
            />
            {shown && shownLine !== null && (
                <div className="ghost" style={{ top: `calc(${PAD_TOP + (shownLine + 1) * LINE_HEIGHT}px - var(--scroll, 0px))` }}>
                    <p className="ghost-title">Suggested rewrite</p>
                    <p>{shown.rewrite}</p>
                </div>
            )}
        </div>
    );
}
