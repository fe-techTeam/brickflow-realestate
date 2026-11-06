/**
 * Structural safety check for uploaded PDFs. Pure (no I/O), so it is unit-testable and reusable.
 *
 * The file's dictionaries are tokenised with every stream body removed; Flate-encoded streams that
 * are not images or fonts (object streams in particular, where modern writers keep the catalog and
 * annotations) are inflated and tokenised too. Name objects are compared after `#xx` decoding, so
 * `/J#61vaScript` is caught. Literal strings and comments are skipped to avoid false positives.
 */
import { constants, inflateSync } from "node:zlib";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";

export type PdfRejectionReason = "encrypted" | "active_content" | "embedded_file" | "unreadable" | "too_many_pages" | "no_pages";

export type PdfInspection = { ok: true; pageCount: number } | { ok: false; reason: PdfRejectionReason; message: string; detail?: string };

export const DEFAULT_MAX_PDF_PAGES = 50;
const MAX_INFLATED_BYTES = 50 * 1024 * 1024;

const MESSAGES: Record<Exclude<PdfRejectionReason, "too_many_pages">, string> = {
  encrypted: "Password-protected or encrypted PDFs are not accepted. Upload an unprotected copy of the invoice.",
  active_content: "This PDF contains scripts, automatic actions or embedded files, so it can't be accepted. Save or print it as a plain PDF and upload it again.",
  embedded_file: "This PDF contains scripts, automatic actions or embedded files, so it can't be accepted. Save or print it as a plain PDF and upload it again.",
  unreadable: "This file couldn't be read as a valid PDF. Export the invoice to PDF again and upload the new file.",
  no_pages: "This PDF has no pages. Upload the complete invoice.",
};

const ACTIVE_NAMES = new Set(["JavaScript", "JS", "AA", "Launch", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToE"]);
const EMBEDDED_NAMES = new Set(["EmbeddedFile", "EmbeddedFiles", "FileAttachment"]);
const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === "\0";
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

interface NameToken {
  name: string;
  /** Index just after the name in the scanned text. */
  end: number;
}

/** Yields every name object outside literal strings and comments. */
function* names(text: string): Generator<NameToken> {
  let i = 0;
  const length = text.length;
  while (i < length) {
    const char = text[i]!;
    if (char === "(") {
      let depth = 1;
      i += 1;
      while (i < length && depth > 0) {
        const c = text[i]!;
        if (c === "\\") i += 2;
        else {
          if (c === "(") depth += 1;
          else if (c === ")") depth -= 1;
          i += 1;
        }
      }
    } else if (char === "%") {
      while (i < length && text[i] !== "\n" && text[i] !== "\r") i += 1;
    } else if (char === "/") {
      let j = i + 1;
      while (j < length && !isWhitespace(text[j]) && !DELIMITERS.has(text[j]!)) j += 1;
      yield { name: decodeName(text.slice(i + 1, j)), end: j };
      i = j;
    } else {
      i += 1;
    }
  }
}

interface StreamSpan {
  dict: string;
  dataStart: number;
  dataEnd: number;
  /** Index after the `endstream` keyword. */
  end: number;
}

/** Locates `stream … endstream` bodies together with the dictionary that precedes each one. */
function streams(text: string): StreamSpan[] {
  const spans: StreamSpan[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf("stream", from);
    if (at < 0) break;
    const after = text[at + 6];
    if (text.slice(Math.max(0, at - 3), at) === "end" || (after !== "\r" && after !== "\n")) {
      from = at + 6;
      continue;
    }
    const dataStart = at + 6 + (text.startsWith("\r\n", at + 6) ? 2 : 1);
    const objAt = text.lastIndexOf("obj", at);
    const dict = text.slice(objAt < 0 ? Math.max(0, at - 4096) : objAt + 3, at);
    const endAt = text.indexOf("endstream", dataStart);
    if (endAt < 0) {
      spans.push({ dict, dataStart, dataEnd: text.length, end: text.length });
      break;
    }
    let dataEnd = endAt;
    if (text[dataEnd - 1] === "\n") dataEnd -= 1;
    if (text[dataEnd - 1] === "\r") dataEnd -= 1;
    spans.push({ dict, dataStart, dataEnd: Math.max(dataStart, dataEnd), end: endAt + 9 });
    from = endAt + 9;
  }
  return spans;
}

function dictNames(dict: string): string[] {
  return [...names(dict)].map((t) => t.name);
}

type Verdict = { reason: PdfRejectionReason; detail: string } | null;

function judge(text: string): Verdict {
  for (const token of names(text)) {
    if (token.name === "Encrypt") return { reason: "encrypted", detail: "/Encrypt" };
    if (ACTIVE_NAMES.has(token.name)) return { reason: "active_content", detail: `/${token.name}` };
    if (EMBEDDED_NAMES.has(token.name)) return { reason: "embedded_file", detail: `/${token.name}` };
    if (token.name === "OpenAction") {
      let k = token.end;
      while (k < text.length && isWhitespace(text[k])) k += 1;
      // A destination array only selects the opening page; anything else is an action.
      if (text[k] !== "[") return { reason: "active_content", detail: "/OpenAction" };
    }
  }
  return null;
}

/** Scans the object structure for encryption, active content and embedded files. */
export function scanPdfStructure(bytes: Uint8Array): Verdict {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const spans = streams(text);

  let structure = "";
  let cursor = 0;
  for (const span of spans) {
    structure += text.slice(cursor, span.dataStart) + "\n";
    cursor = span.dataEnd;
  }
  structure += text.slice(cursor);
  const structural = judge(structure);
  if (structural) return structural;

  let budget = MAX_INFLATED_BYTES;
  for (const span of spans) {
    const keys = dictNames(span.dict);
    const isImage = keys.includes("Image");
    const isFont = keys.some((k) => k === "Length1" || k === "Length2" || k === "Length3" || k === "Type1C" || k === "CIDFontType0C" || k === "OpenType");
    const isXref = keys.includes("XRef");
    if (isImage || isFont || isXref) continue;

    const filterAt = keys.indexOf("Filter");
    const filters = filterAt < 0 ? [] : keys.slice(filterAt + 1).filter((k) => /Decode$|^(Fl|AHx|A85|LZW|RL|CCF|DCT)$/.test(k));
    const raw = Buffer.from(text.slice(span.dataStart, span.dataEnd), "latin1");
    let decoded: Buffer | null = null;
    if (filters.length === 0) decoded = raw;
    else if (filters.length === 1 && (filters[0] === "FlateDecode" || filters[0] === "Fl")) {
      try {
        decoded = inflateSync(raw, { maxOutputLength: Math.max(1, budget), finishFlush: constants.Z_SYNC_FLUSH });
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return { reason: "unreadable", detail: "stream too large" };
        decoded = null;
      }
    } else if (keys.includes("ObjStm")) {
      return { reason: "unreadable", detail: `object stream with ${filters.join(",")}` };
    }
    if (!decoded) continue;
    budget -= decoded.byteLength;
    if (budget <= 0) return { reason: "unreadable", detail: "decoded content too large" };
    const verdict = judge(decoded.toString("latin1"));
    if (verdict) return verdict;
  }
  return null;
}

/** Full inspection: structure scan, then parsing and page count with pdf-lib. */
export async function inspectPdf(bytes: Uint8Array, options: { maxPages?: number } = {}): Promise<PdfInspection> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PDF_PAGES;
  const verdict = scanPdfStructure(bytes);
  if (verdict) return { ok: false, reason: verdict.reason, message: MESSAGES[verdict.reason as Exclude<PdfRejectionReason, "too_many_pages">], detail: verdict.detail };

  let pageCount: number;
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = document.getPageCount();
  } catch (error) {
    if (error instanceof EncryptedPDFError) return { ok: false, reason: "encrypted", message: MESSAGES.encrypted, detail: "EncryptedPDFError" };
    return { ok: false, reason: "unreadable", message: MESSAGES.unreadable, detail: error instanceof Error ? error.message.slice(0, 200) : "parse failed" };
  }
  if (pageCount < 1) return { ok: false, reason: "no_pages", message: MESSAGES.no_pages };
  if (pageCount > maxPages) {
    return {
      ok: false,
      reason: "too_many_pages",
      message: `This PDF has ${pageCount} pages; invoices are limited to ${maxPages}. Upload only the invoice pages.`,
      detail: String(pageCount),
    };
  }
  return { ok: true, pageCount };
}

export function maxPdfPagesFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.UPLOAD_MAX_PDF_PAGES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PDF_PAGES;
}
