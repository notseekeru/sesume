import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { tokenize } from "../lib/latex";
import { callByLine, type LineCall, lineOf } from "../lib/resumeText";

const LINE_HEIGHT = 20;

export interface CodeEditorProps {
    value: string;
    latex: boolean;
    marks: { text: string; call: LineCall }[];
    focus: { quote: string; n: number } | null;
    placeholder: string;
    onChange: (value: string) => void;
}

export function CodeEditor({ value, latex, marks, focus, placeholder, onChange }: CodeEditorProps) {
    const layer = useRef<HTMLPreElement>(null);
    const area = useRef<HTMLTextAreaElement>(null);
    const gutter = useRef<HTMLDivElement>(null);
    const seen = useRef(0);
    const rows = useMemo(() => value.split("\n"), [value]);
    const calls = useMemo(() => callByLine(value, marks), [value, marks]);

    const sync = useCallback((node: HTMLTextAreaElement) => {
        if (layer.current) {
            layer.current.scrollTop = node.scrollTop;
            layer.current.scrollLeft = node.scrollLeft;
        }
        if (gutter.current) gutter.current.style.transform = `translateY(${-node.scrollTop}px)`;
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
        node.scrollTop = Math.max(0, line * LINE_HEIGHT - LINE_HEIGHT * 3);
        sync(node);
    }, [focus, rows, value, sync]);

    return (
        <div className="editor">
            <div className="gutter" aria-hidden>
                <div ref={gutter} className="gutter-inner">
                    {rows.map((row, index) => (
                        <div key={`${index}:${row}`} className={calls.has(index) ? `no ${calls.get(index)}` : "no"}>
                            {index + 1}
                        </div>
                    ))}
                </div>
            </div>
            <pre ref={layer} className="layer" aria-hidden>
                {rows.map((row, index) => {
                    const call = calls.get(index);
                    return (
                        <span key={`${index}:${row}`} className={call ? `line ${call}` : "line"}>
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
            <textarea ref={area} className="input" value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => sync(event.currentTarget)} spellCheck={false} wrap="off" placeholder={placeholder} aria-label="Resume source" />
        </div>
    );
}
