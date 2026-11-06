/**
 * Structural safety check for uploaded PDFs. Pure (no I/O), so it is unit-testable and reusable.
 *
 * Two independent layers, both of which must pass:
 *
 * 1. Parsed object graph (authoritative). The document is loaded with pdf-lib, the same parser the
 *    platform uses for page counts, which also parses compressed object streams. Every indirect
 *    object is walked and rejected on encryption, scripts, automatic or remote actions and
 *    embedded files.
 * 2. Raw bytes (defence in depth against parser differentials). Dictionaries outside stream bodies
 *    are tokenised; stream dictionaries are parsed and skipped only on their parsed values
 *    (`/Subtype /Image`, `/Type /XRef`, streams referenced by `/FontFile*`, image-only codecs).
 *    Every other stream, object streams always, is decoded and scanned. A stream that cannot be
 *    decoded, or uses a filter or predictor this module cannot reverse, fails closed as unreadable.
 *
 * Names are compared after `#xx` decoding, so `/J#61vaScript` is caught. Literal strings and
 * comments are skipped by the raw tokenizer to avoid false positives.
 */
import { constants, inflateSync } from "node:zlib";
import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString, type PDFObject } from "pdf-lib";

export type PdfRejectionReason = "encrypted" | "active_content" | "embedded_file" | "unreadable" | "too_many_pages" | "no_pages";

export type PdfInspection = { ok: true; pageCount: number } | { ok: false; reason: PdfRejectionReason; message: string; detail?: string };

export const DEFAULT_MAX_PDF_PAGES = 50;
/** Decompression-bomb guard: total bytes all decoded streams may expand to. */
const MAX_DECODED_BYTES = 50 * 1024 * 1024;
const MAX_WALK_DEPTH = 64;

const MESSAGES: Record<Exclude<PdfRejectionReason, "too_many_pages">, string> = {
  encrypted: "Password-protected or encrypted PDFs are not accepted. Upload an unprotected copy of the invoice.",
  active_content: "This PDF contains scripts, automatic actions or embedded files, so it can't be accepted. Save or print it as a plain PDF and upload it again.",
  embedded_file: "This PDF contains scripts, automatic actions or embedded files, so it can't be accepted. Save or print it as a plain PDF and upload it again.",
  unreadable: "This file couldn't be read as a valid PDF. Export the invoice to PDF again and upload the new file.",
  no_pages: "This PDF has no pages. Upload the complete invoice.",
};

/** Names that are rejected wherever they appear, as a key or as a value (e.g. `/S /JavaScript`). */
const ACTIVE_NAMES = new Set(["JavaScript", "JS", "AA", "Launch", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToR", "GoToE", "Rendition", "Movie", "Sound"]);
const EMBEDDED_NAMES = new Set(["EmbeddedFile", "EmbeddedFiles", "FileAttachment"]);
const SAFE_URI = /^(https?:|mailto:)/i;
const IMAGE_ONLY_FILTERS = new Set(["DCTDecode", "DCT", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode", "CCF"]);

type Verdict = { reason: PdfRejectionReason; detail: string } | null;

function classify(name: string): Verdict {
  if (name === "Encrypt") return { reason: "encrypted", detail: "/Encrypt" };
  if (ACTIVE_NAMES.has(name)) return { reason: "active_content", detail: `/${name}` };
  if (EMBEDDED_NAMES.has(name)) return { reason: "embedded_file", detail: `/${name}` };
  return null;
}

/* ----------------------------------------------------------------------------------------------
 * Layer 1: the parsed object graph.
 * -------------------------------------------------------------------------------------------- */

function nameOf(object: PDFObject | undefined): string | null {
  if (!(object instanceof PDFName)) return null;
  try {
    return object.decodeText();
  } catch {
    return object.asString().slice(1);
  }
}

function textOf(object: PDFObject | undefined): string | null {
  if (object instanceof PDFString || object instanceof PDFHexString) {
    try {
      return object.decodeText();
    } catch {
      return null;
    }
  }
  return null;
}

function walk(object: PDFObject, depth: number): Verdict {
  if (depth > MAX_WALK_DEPTH) return { reason: "unreadable", detail: "object nesting too deep" };
  const dict = object instanceof PDFStream ? object.dict : object;
  if (dict instanceof PDFDict) {
    for (const [key, value] of dict.entries()) {
      const name = nameOf(key) ?? "";
      const verdict = classify(name);
      if (verdict) return verdict;
      if (name === "OpenAction" && !(value instanceof PDFArray)) return { reason: "active_content", detail: "/OpenAction" };
      if (name === "URI") {
        const uri = textOf(value);
        if (uri !== null && !SAFE_URI.test(uri.trim())) return { reason: "active_content", detail: "/URI scheme" };
      }
      const nested = walk(value, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (object instanceof PDFArray) {
    for (const item of object.asArray()) {
      const nested = walk(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  const name = nameOf(object);
  return name ? classify(name) : null;
}

/** Walks every indirect object pdf-lib parsed, including those inside object streams. */
export function scanParsedDocument(document: PDFDocument): Verdict {
  if (document.context.trailerInfo.Encrypt) return { reason: "encrypted", detail: "trailer /Encrypt" };
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    const verdict = walk(object, 0);
    if (verdict) return verdict;
  }
  return null;
}

/* ----------------------------------------------------------------------------------------------
 * Layer 2: raw bytes.
 * -------------------------------------------------------------------------------------------- */

const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === "\0";
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

interface NameToken {
  name: string;
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

function judge(text: string): Verdict {
  for (const token of names(text)) {
    const verdict = classify(token.name);
    if (verdict) return verdict;
    if (token.name === "OpenAction") {
      let k = token.end;
      while (k < text.length && isWhitespace(text[k])) k += 1;
      // A destination array only selects the opening page; anything else is an action.
      if (text[k] !== "[") return { reason: "active_content", detail: "/OpenAction" };
    }
  }
  return null;
}

/** Minimal PDF value model for stream dictionaries. */
type RawValue =
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "ref"; num: number }
  | { kind: "array"; items: RawValue[] }
  | { kind: "dict"; entries: Map<string, RawValue> }
  | { kind: "other" };

/** Parses the first `<< … >>` dictionary in `text`. Returns null when it is malformed. */
export function parseRawDict(text: string): Map<string, RawValue> | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (isWhitespace(c)) i += 1;
    else if (c === "%") while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i += 1;
    else if ((c === "<" && text[i + 1] === "<") || (c === ">" && text[i + 1] === ">")) {
      tokens.push(c + c);
      i += 2;
    } else if (c === "[" || c === "]") {
      tokens.push(c);
      i += 1;
    } else if (c === "(") {
      let depth = 1;
      i += 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") depth -= 1;
        i += 1;
      }
      tokens.push("(str)");
    } else if (c === "<") {
      const close = text.indexOf(">", i);
      i = close < 0 ? text.length : close + 1;
      tokens.push("(str)");
    } else if (c === "/") {
      let j = i + 1;
      while (j < text.length && !isWhitespace(text[j]) && !DELIMITERS.has(text[j]!)) j += 1;
      tokens.push(`/${decodeName(text.slice(i + 1, j))}`);
      i = j;
    } else {
      let j = i;
      while (j < text.length && !isWhitespace(text[j]) && !DELIMITERS.has(text[j]!)) j += 1;
      tokens.push(text.slice(i, Math.max(j, i + 1)));
      i = Math.max(j, i + 1);
    }
  }

  let pos = tokens.indexOf("<<");
  if (pos < 0) return null;
  const value = (): RawValue | null => {
    const token = tokens[pos];
    if (token === undefined) return null;
    if (token === "<<") {
      pos += 1;
      const entries = new Map<string, RawValue>();
      while (pos < tokens.length && tokens[pos] !== ">>") {
        const key = tokens[pos]!;
        if (!key.startsWith("/")) return null;
        pos += 1;
        const v = value();
        if (!v) return null;
        entries.set(key.slice(1), v);
      }
      if (tokens[pos] !== ">>") return null;
      pos += 1;
      return { kind: "dict", entries };
    }
    if (token === "[") {
      pos += 1;
      const items: RawValue[] = [];
      while (pos < tokens.length && tokens[pos] !== "]") {
        const v = value();
        if (!v) return null;
        items.push(v);
      }
      if (tokens[pos] !== "]") return null;
      pos += 1;
      return { kind: "array", items };
    }
    pos += 1;
    if (token.startsWith("/")) return { kind: "name", value: token.slice(1) };
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) {
      if (/^\d+$/.test(token) && /^\d+$/.test(tokens[pos] ?? "") && tokens[pos + 1] === "R") {
        pos += 2;
        return { kind: "ref", num: Number(token) };
      }
      return { kind: "number", value: Number(token) };
    }
    return { kind: "other" };
  };
  const parsed = value();
  return parsed?.kind === "dict" ? parsed.entries : null;
}

interface StreamSpan {
  dict: Map<string, RawValue> | null;
  objectNumber: number | null;
  dataStart: number;
  dataEnd: number;
}

const OBJECT_HEADER = /(?<![\d])(\d+)\s+\d+\s+obj\b/g;

/** Locates `stream … endstream` bodies together with the parsed dictionary that precedes each one. */
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
    const windowStart = Math.max(from, at - 65_536);
    let header: RegExpExecArray | null = null;
    for (const match of text.slice(windowStart, at).matchAll(OBJECT_HEADER)) header = match;
    const dictText = text.slice(header ? windowStart + header.index + header[0].length : Math.max(from, at - 4096), at);
    const endAt = text.indexOf("endstream", dataStart);
    let dataEnd = endAt < 0 ? text.length : endAt;
    if (text[dataEnd - 1] === "\n") dataEnd -= 1;
    if (text[dataEnd - 1] === "\r") dataEnd -= 1;
    spans.push({ dict: parseRawDict(dictText), objectNumber: header ? Number(header[1]) : null, dataStart, dataEnd: Math.max(dataStart, dataEnd) });
    if (endAt < 0) break;
    from = endAt + 9;
  }
  return spans;
}

class UndecodableStream extends Error {}

function asNames(value: RawValue | undefined): string[] {
  if (!value) return [];
  if (value.kind === "name") return [value.value];
  if (value.kind === "array") return value.items.map((v) => (v.kind === "name" ? v.value : "?"));
  return ["?"];
}

function asParams(value: RawValue | undefined, count: number): (Map<string, RawValue> | null)[] {
  if (!value) return Array.from({ length: count }, () => null);
  if (value.kind === "dict") return [value.entries, ...Array.from({ length: count - 1 }, () => null)];
  if (value.kind === "array") return Array.from({ length: count }, (_, i) => (value.items[i]?.kind === "dict" ? (value.items[i] as { entries: Map<string, RawValue> }).entries : null));
  return Array.from({ length: count }, () => null);
}

function numberParam(params: Map<string, RawValue> | null, key: string, fallback: number): number {
  const value = params?.get(key);
  return value?.kind === "number" ? value.value : fallback;
}

function decodeAsciiHex(input: Buffer): Buffer {
  const text = input.toString("latin1").replace(/\s+/g, "");
  const end = text.indexOf(">");
  const hex = end < 0 ? text : text.slice(0, end);
  if (!/^[0-9A-Fa-f]*$/.test(hex)) throw new UndecodableStream("ASCIIHexDecode");
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
}

function decodeAscii85(input: Buffer): Buffer {
  const text = input.toString("latin1").replace(/\s+/g, "").replace(/^<~/, "");
  const end = text.indexOf("~>");
  const body = end < 0 ? text : text.slice(0, end);
  const out: number[] = [];
  let group: number[] = [];
  for (const char of body) {
    if (char === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = char.charCodeAt(0) - 33;
    if (code < 0 || code > 84) throw new UndecodableStream("ASCII85Decode");
    group.push(code);
    if (group.length === 5) {
      const value = group.reduce((acc, d) => acc * 85 + d, 0);
      if (value > 0xffffffff) throw new UndecodableStream("ASCII85Decode");
      out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
      group = [];
    }
  }
  if (group.length === 1) throw new UndecodableStream("ASCII85Decode");
  if (group.length) {
    const padded = [...group, ...Array(5 - group.length).fill(84)];
    const value = padded.reduce((acc, d) => acc * 85 + d, 0);
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, group.length - 1));
  }
  return Buffer.from(out);
}

function decodeRunLength(input: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const length = input[i]!;
    if (length === 128) break;
    if (length < 128) {
      if (i + 1 + length + 1 > input.length) throw new UndecodableStream("RunLengthDecode");
      for (let k = 0; k <= length; k += 1) out.push(input[i + 1 + k]!);
      i += length + 2;
    } else {
      if (i + 1 >= input.length) throw new UndecodableStream("RunLengthDecode");
      for (let k = 0; k < 257 - length; k += 1) out.push(input[i + 1]!);
      i += 2;
    }
  }
  return Buffer.from(out);
}

/** Reverses PNG row predictors (Predictor 10–15). */
function undoPngPredictor(data: Buffer, params: Map<string, RawValue> | null): Buffer {
  const colors = numberParam(params, "Colors", 1);
  const bits = numberParam(params, "BitsPerComponent", 8);
  const columns = numberParam(params, "Columns", 1);
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.ceil((colors * bits * columns) / 8);
  if (rowLength <= 0 || rowLength > 1 << 24) throw new UndecodableStream("predictor parameters");
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = Buffer.alloc(rows * rowLength);
  for (let r = 0; r < rows; r += 1) {
    const type = data[r * (rowLength + 1)]!;
    const src = r * (rowLength + 1) + 1;
    const dst = r * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const raw = data[src + x]!;
      const left = x >= bpp ? out[dst + x - bpp]! : 0;
      const up = r > 0 ? out[dst - rowLength + x]! : 0;
      const upLeft = r > 0 && x >= bpp ? out[dst - rowLength + x - bpp]! : 0;
      let value: number;
      switch (type) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new UndecodableStream("PNG predictor row type");
      }
      out[dst + x] = value & 255;
    }
  }
  return out;
}

/** Applies a stream's filter chain; throws UndecodableStream for anything it cannot reverse exactly. */
function decodeStream(raw: Buffer, filters: string[], params: (Map<string, RawValue> | null)[], budget: number): Buffer {
  let data = raw;
  filters.forEach((filter, index) => {
    switch (filter) {
      case "FlateDecode":
      case "Fl":
        try {
          data = inflateSync(data, { maxOutputLength: Math.max(1, budget), finishFlush: constants.Z_SYNC_FLUSH });
        } catch (error) {
          if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new UndecodableStream("decoded content too large");
          throw new UndecodableStream("corrupt FlateDecode data");
        }
        break;
      case "ASCIIHexDecode":
      case "AHx":
        data = decodeAsciiHex(data);
        break;
      case "ASCII85Decode":
      case "A85":
        data = decodeAscii85(data);
        break;
      case "RunLengthDecode":
      case "RL":
        data = decodeRunLength(data);
        break;
      default:
        throw new UndecodableStream(`unsupported filter ${filter}`);
    }
    const predictor = numberParam(params[index] ?? null, "Predictor", 1);
    if (predictor >= 10) data = undoPngPredictor(data, params[index] ?? null);
    else if (predictor !== 1) throw new UndecodableStream(`unsupported predictor ${predictor}`);
    if (data.byteLength > budget) throw new UndecodableStream("decoded content too large");
  });
  return data;
}

const FONT_FILE_REF = /\/FontFile[23]?\s+(\d+)\s+\d+\s+R/g;

/** Scans the raw object structure for encryption, active content and embedded files. */
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

  let budget = MAX_DECODED_BYTES;
  const decodedText = new Map<StreamSpan, string>();
  const decode = (span: StreamSpan): string | Verdict => {
    const filters = asNames(span.dict?.get("Filter"));
    const params = asParams(span.dict?.get("DecodeParms") ?? span.dict?.get("DP"), filters.length);
    try {
      const decoded = decodeStream(Buffer.from(text.slice(span.dataStart, span.dataEnd), "latin1"), filters, params, budget);
      budget -= decoded.byteLength;
      if (budget <= 0) return { reason: "unreadable", detail: "decoded content too large" };
      return decoded.toString("latin1");
    } catch (error) {
      if (error instanceof UndecodableStream) return { reason: "unreadable", detail: error.message };
      throw error;
    }
  };

  // Object streams hold dictionaries (the catalog, actions, annotations), so they are always decoded first.
  for (const span of spans) {
    const type = span.dict?.get("Type");
    if (!span.dict) return { reason: "unreadable", detail: "malformed stream dictionary" };
    if (type?.kind !== "name" || type.value !== "ObjStm") continue;
    const result = decode(span);
    if (typeof result !== "string") return result;
    const verdict = judge(result);
    if (verdict) return verdict;
    decodedText.set(span, result);
  }

  const fontFiles = new Set<number>();
  for (const source of [structure, ...decodedText.values()]) {
    for (const match of source.matchAll(FONT_FILE_REF)) fontFiles.add(Number(match[1]));
  }

  for (const span of spans) {
    if (decodedText.has(span)) continue;
    const dict = span.dict!;
    const type = dict.get("Type");
    const subtype = dict.get("Subtype");
    if (type?.kind === "name" && type.value === "XRef") continue;
    if (subtype?.kind === "name" && subtype.value === "Image") continue;
    if (span.objectNumber !== null && fontFiles.has(span.objectNumber)) continue;
    // Image-only codecs (JPEG, JPEG 2000, JBIG2, CCITT) cannot carry objects a viewer would interpret.
    if (asNames(dict.get("Filter")).some((f) => IMAGE_ONLY_FILTERS.has(f))) continue;
    const result = decode(span);
    if (typeof result !== "string") return result;
    const verdict = judge(result);
    if (verdict) return verdict;
  }
  return null;
}

/** Full inspection: raw structure scan, then parsing with pdf-lib, the parsed-graph scan and the page count. */
export async function inspectPdf(bytes: Uint8Array, options: { maxPages?: number } = {}): Promise<PdfInspection> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PDF_PAGES;
  const reject = (verdict: NonNullable<Verdict>): PdfInspection => ({
    ok: false,
    reason: verdict.reason,
    message: MESSAGES[verdict.reason as Exclude<PdfRejectionReason, "too_many_pages">],
    detail: verdict.detail,
  });

  const raw = scanPdfStructure(bytes);
  if (raw) return reject(raw);

  let pageCount: number;
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const parsed = scanParsedDocument(document);
    if (parsed) return reject(parsed);
    pageCount = document.getPageCount();
  } catch (error) {
    if (error instanceof EncryptedPDFError) return reject({ reason: "encrypted", detail: "EncryptedPDFError" });
    return reject({ reason: "unreadable", detail: error instanceof Error ? error.message.slice(0, 200) : "parse failed" });
  }
  if (pageCount < 1) return reject({ reason: "no_pages", detail: "0" });
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
