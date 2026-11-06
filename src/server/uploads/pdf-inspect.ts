/**
 * Structural safety check for uploaded PDFs. Pure (no I/O), so it is unit-testable and reusable.
 *
 * Two independent layers, both of which must pass:
 *
 * 1. Parsed object graph (authoritative). The document is loaded with pdf-lib, the same parser the
 *    platform uses for page counts, which also parses compressed object streams. Every indirect
 *    object is walked; references are resolved before action, `/S` and `/URI` values are checked.
 * 2. Raw bytes (defence in depth against parser differentials). The file is tokenised forward,
 *    skipping literal strings, hex strings and comments, so `N G obj << … >> stream` is recognised
 *    only at token level and a stream body is delimited by its `/Length`. Every object definition is
 *    checked, including superseded ones in incremental updates; an object defined twice within one
 *    revision is rejected. Streams are skipped only on parsed values (`/Subtype /Image`,
 *    `/Type /XRef`, streams referenced by `/FontFile*`, image-only codecs); object streams are always
 *    decoded. Undecodable streams, unsupported filters and decoded output beyond a document-wide
 *    budget fail closed as unreadable.
 */
import { constants, inflateSync } from "node:zlib";
import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFContext, type PDFObject } from "pdf-lib";

export type PdfRejectionReason = "encrypted" | "active_content" | "embedded_file" | "unreadable" | "too_many_pages" | "no_pages";

export type PdfInspection = { ok: true; pageCount: number } | { ok: false; reason: PdfRejectionReason; message: string; detail?: string };

export const DEFAULT_MAX_PDF_PAGES = 50;
/** Decompression-bomb guard: total bytes every decoder may produce across the whole document. */
export const MAX_DECODED_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 64;

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
/** Action types an invoice may carry: internal navigation, web links and named viewer commands. */
const ALLOWED_ACTIONS = new Set(["GoTo", "URI", "Named"]);
const SAFE_URI = /^(https?:|mailto:)/i;
const IMAGE_ONLY_FILTERS = new Set(["DCTDecode", "DCT", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode", "CCF"]);

type Verdict = { reason: PdfRejectionReason; detail: string } | null;

class Rejection extends Error {
  constructor(readonly verdict: NonNullable<Verdict>) {
    super(verdict.detail);
  }
}
class Malformed extends Error {}
class UndecodableStream extends Error {}

function classify(name: string): Verdict {
  if (name === "Encrypt") return { reason: "encrypted", detail: "/Encrypt" };
  if (ACTIVE_NAMES.has(name)) return { reason: "active_content", detail: `/${name}` };
  if (EMBEDDED_NAMES.has(name)) return { reason: "embedded_file", detail: `/${name}` };
  return null;
}

const active = (detail: string): NonNullable<Verdict> => ({ reason: "active_content", detail });

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

function resolve(context: PDFContext, object: PDFObject | undefined): PDFObject | undefined {
  let current = object;
  for (let hops = 0; current instanceof PDFRef && hops < 8; hops += 1) current = context.lookup(current);
  return current instanceof PDFRef ? undefined : current;
}

function checkUri(context: PDFContext, value: PDFObject | undefined): Verdict {
  const resolved = resolve(context, value);
  if (resolved instanceof PDFDict) {
    // The catalog's URI dictionary only carries a base for relative links.
    const base = resolved.get(PDFName.of("Base"));
    return base === undefined ? null : checkUri(context, base);
  }
  const uri = textOf(resolved);
  if (uri === null || !SAFE_URI.test(uri.trim())) return active("/URI scheme");
  return null;
}

/** Actions are allow-listed; a value that should be an action but isn't one fails closed. */
function checkAction(context: PDFContext, value: PDFObject | undefined, depth: number): Verdict {
  if (depth > MAX_DEPTH) return { reason: "unreadable", detail: "action chain too deep" };
  const resolved = resolve(context, value);
  if (resolved instanceof PDFArray) {
    for (const item of resolved.asArray()) {
      const verdict = checkAction(context, item, depth + 1);
      if (verdict) return verdict;
    }
    return null;
  }
  if (!(resolved instanceof PDFDict)) return active("malformed action");
  const type = nameOf(resolve(context, resolved.get(PDFName.of("S"))));
  if (!type || !ALLOWED_ACTIONS.has(type)) return active(`action ${type ?? "without a type"}`);
  if (type === "URI") {
    const verdict = checkUri(context, resolved.get(PDFName.of("URI")));
    if (verdict) return verdict;
  }
  const next = resolved.get(PDFName.of("Next"));
  return next === undefined ? null : checkAction(context, next, depth + 1);
}

function isActionLike(context: PDFContext, value: PDFObject | undefined): boolean {
  const resolved = resolve(context, value);
  return resolved instanceof PDFArray || (resolved instanceof PDFDict && resolved.has(PDFName.of("S")));
}

function walk(context: PDFContext, object: PDFObject, depth: number): Verdict {
  if (depth > MAX_DEPTH) return { reason: "unreadable", detail: "object nesting too deep" };
  const dict = object instanceof PDFStream ? object.dict : object;
  if (dict instanceof PDFDict) {
    if (nameOf(resolve(context, dict.get(PDFName.of("Type")))) === "Action") {
      const verdict = checkAction(context, dict, 0);
      if (verdict) return verdict;
    }
    for (const [key, value] of dict.entries()) {
      const name = nameOf(key) ?? "";
      const verdict = classify(name);
      if (verdict) return verdict;
      if (name === "OpenAction" && !(resolve(context, value) instanceof PDFArray)) return active("/OpenAction");
      if (name === "URI") {
        const uri = checkUri(context, value);
        if (uri) return uri;
      }
      // Structure attributes also use /A, but carry no /S; anything with /S here is an action.
      if ((name === "A" || name === "Next") && isActionLike(context, value)) {
        const action = checkAction(context, value, 0);
        if (action) return action;
      }
      if (name === "S" || name === "JS" || name === "F") {
        const target = nameOf(resolve(context, value));
        const resolved = target ? classify(target) : null;
        if (resolved) return resolved;
      }
      const nested = walk(context, value, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (object instanceof PDFArray) {
    for (const item of object.asArray()) {
      const nested = walk(context, item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  const name = nameOf(object);
  return name ? classify(name) : null;
}

/** Walks every indirect object pdf-lib parsed, including those inside object streams. */
export function scanParsedDocument(document: PDFDocument): Verdict {
  const { context } = document;
  if (context.trailerInfo.Encrypt) return { reason: "encrypted", detail: "trailer /Encrypt" };
  for (const [, object] of context.enumerateIndirectObjects()) {
    const verdict = walk(context, object, 0);
    if (verdict) return verdict;
  }
  return null;
}

/* ----------------------------------------------------------------------------------------------
 * Layer 2: raw bytes.
 * -------------------------------------------------------------------------------------------- */

const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const INTEGER = /^\d+$/;

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === "\0";
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

interface Token {
  kind: "name" | "number" | "keyword" | "string" | "<<" | ">>" | "[" | "]";
  value: string;
  end: number;
}

/**
 * PDF lexer. In strict mode (file structure, object streams) malformed strings and stray
 * delimiters throw; in lenient mode (content streams) they are skipped.
 */
class Lexer {
  pos: number;
  constructor(
    readonly text: string,
    start = 0,
    readonly strict = true,
  ) {
    this.pos = start;
  }

  private fail(message: string): never {
    throw new Malformed(message);
  }

  next(): Token | null {
    const { text } = this;
    for (;;) {
      while (this.pos < text.length && isWhitespace(text[this.pos])) this.pos += 1;
      if (text[this.pos] !== "%") break;
      while (this.pos < text.length && text[this.pos] !== "\n" && text[this.pos] !== "\r") this.pos += 1;
    }
    if (this.pos >= text.length) return null;
    const start = this.pos;
    const c = text[start]!;

    if (c === "(") {
      let depth = 1;
      let i = start + 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") depth -= 1;
        i += 1;
      }
      if (depth > 0 && this.strict) this.fail("unterminated string");
      this.pos = Math.min(i, text.length);
      return { kind: "string", value: "", end: this.pos };
    }
    if (c === "<" && text[start + 1] === "<") {
      this.pos = start + 2;
      return { kind: "<<", value: "<<", end: this.pos };
    }
    if (c === ">" && text[start + 1] === ">") {
      this.pos = start + 2;
      return { kind: ">>", value: ">>", end: this.pos };
    }
    if (c === "<") {
      const close = text.indexOf(">", start);
      if (close < 0) {
        if (this.strict) this.fail("unterminated hex string");
        this.pos = text.length;
        return null;
      }
      if (this.strict && !/^[0-9A-Fa-f\s]*$/.test(text.slice(start + 1, close))) this.fail("invalid hex string");
      this.pos = close + 1;
      return { kind: "string", value: "", end: this.pos };
    }
    if (c === "[" || c === "]") {
      this.pos = start + 1;
      return { kind: c, value: c, end: this.pos };
    }
    if (c === ">" || c === ")") {
      if (this.strict) this.fail(`stray ${c}`);
      this.pos = start + 1;
      return this.next();
    }
    if (c === "{" || c === "}") {
      this.pos = start + 1;
      return { kind: "keyword", value: c, end: this.pos };
    }
    if (c === "/") {
      let j = start + 1;
      while (j < text.length && !isWhitespace(text[j]) && !DELIMITERS.has(text[j]!)) j += 1;
      this.pos = j;
      return { kind: "name", value: decodeName(text.slice(start + 1, j)), end: j };
    }
    let j = start;
    while (j < text.length && !isWhitespace(text[j]) && !DELIMITERS.has(text[j]!)) j += 1;
    this.pos = j;
    const word = text.slice(start, j);
    return { kind: NUMBER.test(word) ? "number" : "keyword", value: word, end: j };
  }

  peek(count = 1): (Token | null)[] {
    const saved = this.pos;
    const tokens: (Token | null)[] = [];
    for (let i = 0; i < count; i += 1) tokens.push(this.next());
    this.pos = saved;
    return tokens;
  }
}

type RawValue =
  | { kind: "name"; value: string }
  | { kind: "number"; value: number; integer: boolean }
  | { kind: "ref"; num: number }
  | { kind: "array"; items: RawValue[] }
  | { kind: "dict"; entries: [string, RawValue][] }
  | { kind: "other" };

type RawDict = Extract<RawValue, { kind: "dict" }>;

function parseValue(lexer: Lexer, depth = 0): RawValue {
  if (depth > MAX_DEPTH) throw new Malformed("nesting too deep");
  const token = lexer.next();
  if (!token) throw new Malformed("unexpected end of file");
  switch (token.kind) {
    case "<<": {
      const entries: [string, RawValue][] = [];
      for (;;) {
        const key = lexer.next();
        if (!key) throw new Malformed("unterminated dictionary");
        if (key.kind === ">>") return { kind: "dict", entries };
        if (key.kind !== "name") throw new Malformed("dictionary key is not a name");
        entries.push([key.value, parseValue(lexer, depth + 1)]);
      }
    }
    case "[": {
      const items: RawValue[] = [];
      for (;;) {
        const [peeked] = lexer.peek();
        if (!peeked) throw new Malformed("unterminated array");
        if (peeked.kind === "]") {
          lexer.next();
          return { kind: "array", items };
        }
        items.push(parseValue(lexer, depth + 1));
      }
    }
    case "number": {
      const [generation, keyword] = lexer.peek(2);
      if (INTEGER.test(token.value) && generation?.kind === "number" && INTEGER.test(generation.value) && keyword?.kind === "keyword" && keyword.value === "R") {
        lexer.next();
        lexer.next();
        return { kind: "ref", num: Number(token.value) };
      }
      return { kind: "number", value: Number(token.value), integer: INTEGER.test(token.value) };
    }
    case "name":
      return { kind: "name", value: token.value };
    case "string":
      return { kind: "other" };
    case "keyword":
      if (token.value === "true" || token.value === "false" || token.value === "null") return { kind: "other" };
      throw new Malformed(`unexpected keyword ${token.value}`);
    default:
      throw new Malformed(`unexpected ${token.kind}`);
  }
}

/** A key that occurs more than once is ambiguous between parsers, so it fails closed. */
function entry(dict: RawDict, key: string): RawValue | undefined {
  const matches = dict.entries.filter(([k]) => k === key);
  if (matches.length > 1) throw new Malformed(`duplicate /${key}`);
  return matches[0]?.[1];
}

/** Rejects banned names and open actions in a parsed value; collects `/FontFile*` targets. */
function inspectValue(value: RawValue, fontFiles: Set<number>): void {
  if (value.kind === "name") {
    const verdict = classify(value.value);
    if (verdict) throw new Rejection(verdict);
  } else if (value.kind === "array") {
    for (const item of value.items) inspectValue(item, fontFiles);
  } else if (value.kind === "dict") {
    for (const [key, item] of value.entries) {
      const verdict = classify(key);
      if (verdict) throw new Rejection(verdict);
      if (key === "OpenAction" && item.kind !== "array") throw new Rejection(active("/OpenAction"));
      if (/^FontFile[23]?$/.test(key) && item.kind === "ref") fontFiles.add(item.num);
      inspectValue(item, fontFiles);
    }
  }
}

/** Checks every name in decoded content that is not object syntax (content streams, metadata). */
function inspectContent(text: string): void {
  const lexer = new Lexer(text, 0, false);
  for (let token = lexer.next(); token; token = lexer.next()) {
    if (token.kind !== "name") continue;
    const verdict = classify(token.value);
    if (verdict) throw new Rejection(verdict);
    if (token.value === "OpenAction" && lexer.peek()[0]?.kind !== "[") throw new Rejection(active("/OpenAction"));
  }
}

interface StreamSpan {
  dict: RawDict;
  objectNumber: number;
  revision: number;
  dataStart: number;
  dataEnd: number;
  /** Set when /Length is indirect until it has been resolved. */
  pendingLength?: { num: number; endstreamAt: number };
}

/* --- Decoders. Every decoder draws on one document-wide budget and stops as soon as it would exceed it. */

class Budget {
  constructor(public remaining: number) {}
  take(bytes: number) {
    if (bytes > this.remaining) throw new UndecodableStream("decoded content too large");
    this.remaining -= bytes;
  }
}

class Output {
  private buffer: Buffer;
  length = 0;
  constructor(
    private readonly budget: Budget,
    initial: number,
  ) {
    this.buffer = Buffer.alloc(Math.max(16, Math.min(initial, budget.remaining)));
  }
  private reserve(bytes: number) {
    this.budget.take(bytes);
    if (this.length + bytes <= this.buffer.length) return;
    const next = Buffer.alloc(Math.max(this.length + bytes, this.buffer.length * 2));
    this.buffer.copy(next, 0, 0, this.length);
    this.buffer = next;
  }
  push(byte: number) {
    this.reserve(1);
    this.buffer[this.length++] = byte;
  }
  fill(byte: number, count: number) {
    this.reserve(count);
    this.buffer.fill(byte, this.length, this.length + count);
    this.length += count;
  }
  copy(source: Buffer, start: number, end: number) {
    this.reserve(end - start);
    source.copy(this.buffer, this.length, start, end);
    this.length += end - start;
  }
  result(): Buffer {
    return this.buffer.subarray(0, this.length);
  }
}

function decodeFlate(input: Buffer, budget: Budget): Buffer {
  if (budget.remaining <= 0) throw new UndecodableStream("decoded content too large");
  let output: Buffer;
  try {
    output = inflateSync(input, { maxOutputLength: budget.remaining, finishFlush: constants.Z_SYNC_FLUSH });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new UndecodableStream("decoded content too large");
    throw new UndecodableStream("corrupt FlateDecode data");
  }
  budget.take(output.byteLength);
  return output;
}

function decodeAsciiHex(input: Buffer, budget: Budget): Buffer {
  const text = input.toString("latin1").replace(/\s+/g, "");
  const end = text.indexOf(">");
  const hex = end < 0 ? text : text.slice(0, end);
  if (!/^[0-9A-Fa-f]*$/.test(hex)) throw new UndecodableStream("ASCIIHexDecode");
  budget.take(Math.ceil(hex.length / 2));
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
}

function decodeAscii85(input: Buffer, budget: Budget): Buffer {
  const text = input.toString("latin1").replace(/\s+/g, "").replace(/^<~/, "");
  const end = text.indexOf("~>");
  const body = end < 0 ? text : text.slice(0, end);
  const out = new Output(budget, Math.ceil(body.length * 0.8));
  let group: number[] = [];
  const emit = (digits: number[], bytes: number) => {
    const value = digits.reduce((acc, d) => acc * 85 + d, 0);
    if (value > 0xffffffff) throw new UndecodableStream("ASCII85Decode");
    const word = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    for (let k = 0; k < bytes; k += 1) out.push(word[k]!);
  };
  for (const char of body) {
    if (char === "z" && group.length === 0) {
      out.fill(0, 4);
      continue;
    }
    const code = char.charCodeAt(0) - 33;
    if (code < 0 || code > 84) throw new UndecodableStream("ASCII85Decode");
    group.push(code);
    if (group.length === 5) {
      emit(group, 4);
      group = [];
    }
  }
  if (group.length === 1) throw new UndecodableStream("ASCII85Decode");
  if (group.length) emit([...group, ...Array<number>(5 - group.length).fill(84)], group.length - 1);
  return out.result();
}

function decodeRunLength(input: Buffer, budget: Budget): Buffer {
  const out = new Output(budget, input.length);
  let i = 0;
  while (i < input.length) {
    const length = input[i]!;
    if (length === 128) break;
    if (length < 128) {
      if (i + length + 2 > input.length) throw new UndecodableStream("RunLengthDecode");
      out.copy(input, i + 1, i + length + 2);
      i += length + 2;
    } else {
      if (i + 1 >= input.length) throw new UndecodableStream("RunLengthDecode");
      out.fill(input[i + 1]!, 257 - length);
      i += 2;
    }
  }
  return out.result();
}

function numberParam(params: RawDict | null, key: string, fallback: number): number {
  const value = params ? entry(params, key) : undefined;
  return value?.kind === "number" ? value.value : fallback;
}

/** Reverses PNG row predictors (Predictor 10–15). */
function undoPngPredictor(data: Buffer, params: RawDict | null, budget: Budget): Buffer {
  const colors = numberParam(params, "Colors", 1);
  const bits = numberParam(params, "BitsPerComponent", 8);
  const columns = numberParam(params, "Columns", 1);
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.ceil((colors * bits * columns) / 8);
  if (!Number.isInteger(rowLength) || rowLength <= 0 || rowLength > 1 << 24) throw new UndecodableStream("predictor parameters");
  const rows = Math.floor(data.length / (rowLength + 1));
  budget.take(rows * rowLength);
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

function filtersOf(dict: RawDict): string[] {
  const value = entry(dict, "Filter");
  if (!value) return [];
  if (value.kind === "name") return [value.value];
  if (value.kind === "array" && value.items.every((v) => v.kind === "name")) return value.items.map((v) => (v as { value: string }).value);
  throw new UndecodableStream("unsupported filter specification");
}

function paramsOf(dict: RawDict, count: number): (RawDict | null)[] {
  const value = entry(dict, "DecodeParms") ?? entry(dict, "DP");
  if (!value || value.kind === "other") return Array.from({ length: count }, () => null);
  if (value.kind === "dict") return [value, ...Array.from({ length: count - 1 }, () => null)];
  if (value.kind === "array") return Array.from({ length: count }, (_, i) => (value.items[i]?.kind === "dict" ? (value.items[i] as RawDict) : null));
  throw new UndecodableStream("unsupported decode parameters");
}

/** Applies a stream's filter chain; throws UndecodableStream for anything it cannot reverse exactly. */
function decodeStream(raw: Buffer, dict: RawDict, budget: Budget): Buffer {
  const filters = filtersOf(dict);
  const params = paramsOf(dict, filters.length);
  let data = raw;
  filters.forEach((filter, index) => {
    switch (filter) {
      case "FlateDecode":
      case "Fl":
        data = decodeFlate(data, budget);
        break;
      case "ASCIIHexDecode":
      case "AHx":
        data = decodeAsciiHex(data, budget);
        break;
      case "ASCII85Decode":
      case "A85":
        data = decodeAscii85(data, budget);
        break;
      case "RunLengthDecode":
      case "RL":
        data = decodeRunLength(data, budget);
        break;
      default:
        throw new UndecodableStream(`unsupported filter ${filter}`);
    }
    const predictor = numberParam(params[index] ?? null, "Predictor", 1);
    if (predictor >= 10 && predictor <= 15) data = undoPngPredictor(data, params[index] ?? null, budget);
    else if (predictor !== 1) throw new UndecodableStream(`unsupported predictor ${predictor}`);
  });
  return data;
}

function nameEntry(dict: RawDict, key: string): string | null {
  const value = entry(dict, key);
  return value?.kind === "name" ? value.value : null;
}

/** Scans the raw object structure for encryption, active content and embedded files. */
export function scanPdfStructure(bytes: Uint8Array): Verdict {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  try {
    scanRaw(text);
    return null;
  } catch (error) {
    if (error instanceof Rejection) return error.verdict;
    if (error instanceof Malformed || error instanceof UndecodableStream) return { reason: "unreadable", detail: error.message };
    throw error;
  }
}

function scanRaw(text: string): void {
  const lexer = new Lexer(text, 0, true);
  const fontFiles = new Set<number>();
  const integers = new Map<number, number>();
  const definitions = new Map<number, number>();
  const spans: StreamSpan[] = [];
  let revision = 0;

  const define = (num: number, rev: number) => {
    if (definitions.get(num) === rev) throw new Malformed(`object ${num} defined twice`);
    definitions.set(num, rev);
  };

  for (let token = lexer.next(); token; token = lexer.next()) {
    if (token.kind === "number" && INTEGER.test(token.value)) {
      const [generation, keyword] = lexer.peek(2);
      if (generation?.kind !== "number" || !INTEGER.test(generation.value) || keyword?.kind !== "keyword" || keyword.value !== "obj") continue;
      lexer.next();
      lexer.next();
      const num = Number(token.value);
      define(num, revision);
      const value = parseValue(lexer);
      inspectValue(value, fontFiles);
      if (value.kind === "number" && value.integer) integers.set(num, value.value);

      const [after] = lexer.peek();
      if (after?.kind !== "keyword" || after.value !== "stream") continue;
      if (value.kind !== "dict") throw new Malformed("stream without a dictionary");
      lexer.next();
      let dataStart = after.end;
      if (text.startsWith("\r\n", dataStart)) dataStart += 2;
      else if (text[dataStart] === "\n") dataStart += 1;
      else throw new Malformed("stream keyword not followed by an end of line");

      const length = entry(value, "Length");
      const span: StreamSpan = { dict: value, objectNumber: num, revision, dataStart, dataEnd: dataStart };
      if (length?.kind === "number" && length.integer) {
        span.dataEnd = dataStart + length.value;
        let p = span.dataEnd;
        while (p < text.length && isWhitespace(text[p])) p += 1;
        if (span.dataEnd > text.length || !text.startsWith("endstream", p)) throw new Malformed("stream /Length does not match endstream");
        lexer.pos = p + 9;
      } else if (length?.kind === "ref") {
        const endstreamAt = text.indexOf("endstream", dataStart);
        if (endstreamAt < 0) throw new Malformed("missing endstream");
        span.pendingLength = { num: length.num, endstreamAt };
        lexer.pos = endstreamAt + 9;
      } else {
        throw new Malformed("stream without a valid /Length");
      }
      spans.push(span);
    } else if (token.kind === "keyword") {
      if (token.value === "trailer") inspectValue(parseValue(lexer), fontFiles);
      else if (token.value === "startxref") revision += 1;
      else if (token.value === "stream") throw new Malformed("stream keyword outside an object");
    } else if (token.kind === "name") {
      const verdict = classify(token.value);
      if (verdict) throw new Rejection(verdict);
    } else if (token.kind === "<<" || token.kind === "[") {
      lexer.pos -= token.kind.length;
      inspectValue(parseValue(lexer), fontFiles);
    }
  }

  const resolveLengths = (required: boolean) => {
    for (const span of spans) {
      if (!span.pendingLength) continue;
      const length = integers.get(span.pendingLength.num);
      if (length === undefined) {
        if (required) throw new Malformed("unresolvable stream /Length");
        continue;
      }
      const end = span.dataStart + length;
      if (end > span.pendingLength.endstreamAt || !/^\s*$/.test(text.slice(end, span.pendingLength.endstreamAt))) {
        throw new Malformed("stream /Length does not match endstream");
      }
      span.dataEnd = end;
      span.pendingLength = undefined;
    }
  };
  resolveLengths(false);

  const budget = new Budget(MAX_DECODED_BYTES);
  const decode = (span: StreamSpan) => decodeStream(Buffer.from(text.slice(span.dataStart, span.dataEnd), "latin1"), span.dict, budget);

  // Object streams hold dictionaries (the catalog, actions, annotations), so every one is decoded and parsed.
  for (const span of spans) {
    if (nameEntry(span.dict, "Type") !== "ObjStm") continue;
    if (span.pendingLength) throw new Malformed("object stream with an unresolvable /Length");
    const decoded = decode(span).toString("latin1");
    const count = entry(span.dict, "N");
    const first = entry(span.dict, "First");
    if (count?.kind !== "number" || !count.integer || first?.kind !== "number" || !first.integer || first.value > decoded.length) {
      throw new Malformed("object stream without valid /N and /First");
    }
    const header = new Lexer(decoded.slice(0, first.value), 0, true);
    const numbers: number[] = [];
    for (let i = 0; i < count.value; i += 1) {
      const num = header.next();
      const offset = header.next();
      if (num?.kind !== "number" || !INTEGER.test(num.value) || offset?.kind !== "number" || !INTEGER.test(offset.value)) {
        throw new Malformed("object stream header");
      }
      define(Number(num.value), span.revision);
      numbers.push(Number(num.value));
    }
    const body = new Lexer(decoded, first.value, true);
    for (const num of numbers) {
      const value = parseValue(body);
      inspectValue(value, fontFiles);
      if (value.kind === "number" && value.integer) integers.set(num, value.value);
    }
    // Anything after the declared objects is still checked.
    inspectContent(decoded.slice(body.pos));
  }
  resolveLengths(true);

  for (const span of spans) {
    if (nameEntry(span.dict, "Type") === "ObjStm") continue;
    if (nameEntry(span.dict, "Type") === "XRef") continue;
    if (nameEntry(span.dict, "Subtype") === "Image") continue;
    if (fontFiles.has(span.objectNumber)) continue;
    // Image-only codecs (JPEG, JPEG 2000, JBIG2, CCITT) cannot carry objects a viewer would interpret.
    if (filtersOf(span.dict).some((f) => IMAGE_ONLY_FILTERS.has(f))) continue;
    inspectContent(decode(span).toString("latin1"));
  }
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
