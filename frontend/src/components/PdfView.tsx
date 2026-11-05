import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

const SETTLE_MS = 250;

export function PdfView({ data }: { data: Uint8Array }) {
    const host = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const node = host.current;
        if (!node) return;
        let timer = 0;
        const observer = new ResizeObserver((entries) => {
            const next = Math.floor(entries[0].contentRect.width);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setWidth(next), SETTLE_MS);
        });
        observer.observe(node);
        return () => {
            window.clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    useEffect(() => {
        const node = host.current;
        if (!node || width === 0) return;
        let alive = true;
        let task: PDFDocumentLoadingTask | null = null;
        setError(null);
        node.replaceChildren();

        (async () => {
            const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
            GlobalWorkerOptions.workerSrc = workerUrl;
            task = getDocument({ data: new Uint8Array(data) });
            const doc = await task.promise;
            const ratio = Math.min(2, window.devicePixelRatio || 1);
            for (let index = 1; index <= doc.numPages; index += 1) {
                if (!alive) break;
                const page = await doc.getPage(index);
                const base = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: (width * ratio) / base.width });
                const canvas = document.createElement("canvas");
                canvas.className = "pdf-page";
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                canvas.style.width = "100%";
                await page.render({ canvas, viewport }).promise;
                page.cleanup();
                if (!alive) break;
                node.append(canvas);
            }
        })().catch((problem: unknown) => {
            if (alive) setError(problem instanceof Error ? problem.message : "That PDF could not be rendered.");
        });

        return () => {
            alive = false;
            node.replaceChildren();
            void task?.destroy();
        };
    }, [data, width]);

    return (
        <div className="pdf-view">
            <div className="pdf-pages" ref={host} />
            {error && <p className="alert pad">{error}</p>}
        </div>
    );
}
