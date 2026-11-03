"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CARD, Empty } from "../../../_components/kit";

export interface ViewerDocument {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const documentUrl = (id: string) => `/api/documents/invoices/${id}`;
const MAX_PAGES = 6;
const ZOOMS = [0.75, 1, 1.25, 1.5] as const;

type RenderState = { status: "loading" } | { status: "ready"; pages: number } | { status: "failed" };

/** Renders the PDF pages to canvas so the document reads as paper on a light table; falls back to the browser's viewer. */
function PdfPages({ url, title, zoom, onState }: { url: string; title: string; zoom: number; onState: (s: RenderState) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry!.contentRect.width);
      setWidth((prev) => (Math.abs(prev - next) > 24 ? next : prev));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || width === 0) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;

    (async () => {
      try {
        if (!renderedRef.current) onState({ status: "loading" });
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ url, withCredentials: true });
        destroy = () => task.destroy();
        const doc = await task.promise;
        const count = Math.min(doc.numPages, MAX_PAGES);
        const ratio = window.devicePixelRatio || 1;
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= count; n += 1) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const cssWidth = Math.min(width, 860) * zoom;
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${Math.round(cssWidth)}px`;
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${title}, page ${n} of ${doc.numPages}`);
          canvas.className = "mx-auto block max-w-none rounded-[2px] bg-white shadow-[0_1px_1px_rgba(20,43,67,0.08),0_18px_40px_-18px_rgba(20,43,67,0.45)]";
          await page.render({ canvas, viewport, background: "#ffffff" }).promise;
          canvases.push(canvas);
          page.cleanup();
          if (cancelled) return;
        }
        if (cancelled) return;
        host.replaceChildren(...canvases);
        renderedRef.current = true;
        onState({ status: "ready", pages: doc.numPages });
      } catch {
        if (!cancelled) onState({ status: "failed" });
      }
    })();

    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [url, title, width, zoom, onState]);

  return <div ref={hostRef} className="flex flex-col items-stretch gap-8" />;
}

/** The invoice PDF framed for review, with open/download, zoom and earlier versions. */
export function DocumentViewer({ documents, invoiceNumber }: { documents: ViewerDocument[]; invoiceNumber: string }) {
  const [latest, ...earlier] = documents;
  const [state, setState] = useState<RenderState>({ status: "loading" });
  const [zoomIndex, setZoomIndex] = useState(1);

  if (!latest) {
    return (
      <section className={cn(CARD, "animate-fade-up")}>
        <Empty icon={FileText} title="No document attached" description="The channel partner has not attached a PDF to this invoice." />
      </section>
    );
  }
  const url = documentUrl(latest.id);
  const version = documents.length;

  return (
    <section className={cn(CARD, "animate-fade-up overflow-hidden")} aria-label={`Invoice document for ${invoiceNumber}`}>
      <header className="flex flex-col gap-4 border-b border-[#efe9dc] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-9 shrink-0 flex-col items-center justify-end rounded-[3px] border border-[#e3dccb] bg-ivory pb-1 shadow-[2px_2px_0_#ece7db]">
            <span className="text-[0.5rem] font-bold tracking-[0.12em] text-[#93342a]">PDF</span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.875rem] font-medium text-navy">{latest.fileName}</p>
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
              {formatSize(latest.sizeBytes)}
              {state.status === "ready" && ` · ${state.pages} ${state.pages === 1 ? "page" : "pages"}`}
              {version > 1 && ` · version ${version}`} · uploaded {formatDateTime(latest.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.status === "ready" && (
            <div className="mr-1 hidden items-center rounded-md border border-border bg-background md:flex" role="group" aria-label="Zoom">
              <button
                type="button"
                className="flex size-8 items-center justify-center text-muted-foreground hover:text-navy disabled:opacity-40"
                onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
                disabled={zoomIndex === 0}
                aria-label="Zoom out"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="tabular w-11 text-center text-[0.75rem] text-slate-ink">{Math.round(ZOOMS[zoomIndex]! * 100)}%</span>
              <button
                type="button"
                className="flex size-8 items-center justify-center text-muted-foreground hover:text-navy disabled:opacity-40"
                onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))}
                disabled={zoomIndex === ZOOMS.length - 1}
                aria-label="Zoom in"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Open
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`${url}?download=1`} download={latest.fileName}>
              <Download className="size-3.5" />
              Download
            </a>
          </Button>
        </div>
      </header>

      <div className="relative bg-[#e9e4d8] bg-[linear-gradient(rgba(20,43,67,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(20,43,67,0.035)_1px,transparent_1px)] bg-[size:24px_24px] shadow-[inset_0_10px_18px_-14px_rgba(20,43,67,0.35)]">
        {state.status === "failed" ? (
          <object data={`${url}#navpanes=0&view=FitH`} type="application/pdf" title={`Invoice ${invoiceNumber} PDF`} className="block h-[640px] w-full sm:h-[780px]">
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText className="size-8 text-gold-600" strokeWidth={1.5} />
              <p className="text-sm text-slate-ink">This browser cannot display the PDF inline.</p>
              <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  Open {latest.fileName}
                </a>
              </Button>
            </div>
          </object>
        ) : (
          <div className="max-h-[820px] overflow-auto px-4 py-6 sm:px-10 sm:py-10">
            {state.status === "loading" && (
              <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-muted-foreground" aria-live="polite">
                <Loader2 className="size-5 animate-spin text-gold-600" />
                <p className="text-[0.75rem] tracking-wide">Preparing document…</p>
              </div>
            )}
            <PdfPages url={url} title={`Invoice ${invoiceNumber}`} zoom={ZOOMS[zoomIndex]!} onState={setState} />
          </div>
        )}
      </div>

      {earlier.length > 0 && (
        <div className="border-t border-[#efe9dc] px-5 py-4 sm:px-6">
          <p className="mb-2.5 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Earlier versions</p>
          <ul className="space-y-2">
            {earlier.map((doc, i) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                <a href={documentUrl(doc.id)} target="_blank" rel="noopener noreferrer" className="text-navy decoration-gold/60 underline-offset-4 hover:underline">
                  {doc.fileName}
                </a>
                <span className="text-[0.75rem] text-muted-foreground">
                  Version {version - 1 - i} · replaced · uploaded {formatDateTime(doc.createdAt)} · {formatSize(doc.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
