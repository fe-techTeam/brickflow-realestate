import { isTextSparse, linesFromPositionedText, type PositionedText } from "@/lib/extraction/invoice-fields";

export interface ExtractionProgress {
  /** 0..1 */
  progress: number;
  message: string;
}

export interface ExtractedText {
  text: string;
  method: "text" | "ocr";
}

const MAX_TEXT_PAGES = 3;
const OCR_SCALE = 2;

/**
 * Recovers text from a PDF entirely in the browser. Uses the PDF text layer when present; for
 * scanned documents renders page 1 to a canvas and runs Tesseract OCR locally. The document is
 * never uploaded anywhere by this function (Tesseract only downloads its engine and language data).
 */
export async function extractPdfText(file: File, onProgress: (p: ExtractionProgress) => void): Promise<ExtractedText> {
  onProgress({ progress: 0.05, message: "Opening document" });
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const pageCount = Math.min(doc.numPages, MAX_TEXT_PAGES);
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress({ progress: 0.1 + (0.3 * pageNumber) / pageCount, message: `Reading text layer (page ${pageNumber} of ${pageCount})` });
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PositionedText[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height });
      }
      lines.push(...linesFromPositionedText(items, viewport.width));
      page.cleanup();
    }
    const text = lines.join("\n");
    if (!isTextSparse(text)) return { text, method: "text" };

    onProgress({ progress: 0.42, message: "No text layer found — preparing OCR" });
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;

    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: (message) => {
        if (message.status === "recognizing text") {
          onProgress({ progress: 0.55 + message.progress * 0.4, message: `Recognising text (${Math.round(message.progress * 100)}%)` });
        } else {
          onProgress({ progress: 0.45 + message.progress * 0.1, message: "Loading OCR engine" });
        }
      },
    });
    try {
      await worker.setParameters({ preserve_interword_spaces: "1" });
      const result = await worker.recognize(canvas);
      return { text: result.data.text, method: "ocr" };
    } finally {
      await worker.terminate();
    }
  } finally {
    await task.destroy();
  }
}
