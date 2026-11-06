import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";

const SETTLE_MS = 250;
const PIXEL_RATIO_CAP = 2;

// AI HERE: pages rasterize at fit width and zoom scales them with CSS. Ceiling: past 100% the bitmap is
// interpolated. Upgrade path: re-render the visible pages at the zoomed scale once the gesture settles.
export function PdfView({ data, zoom, onZoom, onReset }: { data: Uint8Array; zoom: number; onZoom: (dir: number) => void; onReset: () => void }) {
    const view = useRef<HTMLDivElement>(null);
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
        const node = view.current;
        if (!node) return;
        const wheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            onZoom(event.deltaY < 0 ? 1 : -1);
        };
        node.addEventListener("wheel", wheel, { passive: false });
        return () => node.removeEventListener("wheel", wheel);
    }, [onZoom]);

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
            const ratio = Math.min(PIXEL_RATIO_CAP, window.devicePixelRatio || 1);
            for (let index = 1; index <= doc.numPages; index += 1) {
                if (!alive) break;
                const page = await doc.getPage(index);
                const base = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: (width * ratio) / base.width });
                const canvas = document.createElement("canvas");
                canvas.className = "pdf-page";
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
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

    function keys(event: KeyboardEvent<HTMLDivElement>) {
        if (!event.ctrlKey && !event.metaKey) return;
        if (event.key === "0") {
            event.preventDefault();
            onReset();
            return;
        }
        const dir = event.key === "+" || event.key === "=" ? 1 : event.key === "-" ? -1 : 0;
        if (dir === 0) return;
        event.preventDefault();
        onZoom(dir);
    }

    return (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region has to take focus before its keyboard zoom shortcuts can fire
        <section className="pdf-view" ref={view} aria-label="PDF preview" tabIndex={0} onKeyDown={keys}>
            <div className="pdf-pages" ref={host} style={{ "--page-width": `${(width * zoom) / 100}px` } as CSSProperties} />
            {error && <p className="alert pad">{error}</p>}
        </section>
    );
}
