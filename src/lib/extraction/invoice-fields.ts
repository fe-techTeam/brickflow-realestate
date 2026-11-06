/**
 * Framework-free invoice field extraction. Turns text recovered from a PDF (pdf.js text layer or
 * OCR output) into structured invoice fields. Nothing here performs I/O, so it runs identically in
 * the browser and in unit tests.
 *
 * Text model: one string per visual line. Wide horizontal gaps are encoded as tab characters
 * ("cells"); a line that starts in the right half of the page begins with a tab so column
 * membership survives (see {@link linesFromPositionedText}). OCR text that uses runs of three or
 * more spaces between columns is treated the same way.
 */
import { GST_STATE_CODES } from "../invoice-integrity/gst";
import { formatBps, paiseToDecimalString, parsePercentToBps, parseRupeesToPaise } from "../money";

export interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedInvoiceFields {
  invoiceNumber?: string;
  /** ISO yyyy-mm-dd */
  invoiceDate?: string;
  /** ISO yyyy-mm-dd */
  dueDate?: string;
  supplierName?: string;
  builderName?: string;
  supplierGstin?: string;
  builderGstin?: string;
  /** Every distinct GSTIN found, in document order. */
  gstins: string[];
  /** Amounts as plain decimal rupee strings ("423728.81"), ready for form inputs. */
  taxableAmount?: string;
  cgstAmount?: string;
  sgstAmount?: string;
  igstAmount?: string;
  taxAmount?: string;
  totalAmount?: string;
  /** True when taxable value + tax equals the total (within one rupee). */
  amountsReconcile?: boolean;
  /** GST rate in basis points, from "CGST @ 9%" + "SGST @ 9%" or "IGST @ 18%". */
  gstRateBps?: number;
  /** Two-digit GST state code of the place of supply. */
  placeOfSupplyStateCode?: string;
  /** E-invoice IRN, 64 lower-case hex characters. */
  irn?: string;
  /** 15-digit IRP acknowledgement number. */
  ackNumber?: string;
  /** ISO yyyy-mm-dd */
  ackDate?: string;
  bookingTower?: string;
  bookingUnit?: string;
  /** One to four letters; full buyer names are never extracted. */
  buyerInitials?: string;
  agreementRegistrationNumber?: string;
  /** ISO yyyy-mm-dd */
  agreementDate?: string;
  /** Decimal rupee string, like the other amounts. */
  agreementValue?: string;
  /** Percentage as typed in a form, e.g. "2" or "2.5". */
  agreementBrokerageRate?: string;
  /** TDS rate stated on the invoice, as a percentage string. */
  tdsRate?: string;
}

export interface BuilderCandidate {
  id: string;
  name: string;
  legalName?: string | null;
  gstin?: string | null;
}

export interface ProjectCandidate {
  id: string;
  name: string;
  code: string;
}

export interface BuilderMatch {
  id: string;
  by: "gstin" | "name";
}

export const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
/** OCR frequently reads the fixed 14th GSTIN character "Z" as "2". */
const GSTIN_LOOSE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][Z2][0-9A-Z]\b/g;

const CELL_SPLIT = /\t| {2,}/;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAME = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PATTERNS: { regex: RegExp; read: (m: RegExpMatchArray) => [number, number, number] }[] = [
  { regex: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, read: (m) => [+m[1]!, +m[2]!, +m[3]!] },
  { regex: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-/.]+${MONTH_NAME}\\.?[\\s\\-/.,]+(\\d{4})\\b`, "i"), read: (m) => [+m[3]!, monthNumber(m[2]!), +m[1]!] },
  { regex: new RegExp(`\\b${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"), read: (m) => [+m[3]!, monthNumber(m[1]!), +m[2]!] },
  { regex: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/, read: (m) => [+m[3]!, +m[2]!, +m[1]!] },
  { regex: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})\b/, read: (m) => [2000 + +m[3]!, +m[2]!, +m[1]!] },
];
const AMOUNT = /(?:₹|INR|Rs\.?)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)(?![\d,])/gi;
const PERCENT = /@?\s*\d+(?:\.\d+)?\s*%/g;
const LEGAL_NOISE = /\b(private|pvt|limited|ltd|llp|inc|co|company|the|demo|and)\b/g;

function monthNumber(name: string): number {
  return MONTHS[name.toLowerCase().slice(0, name.toLowerCase().startsWith("sept") ? 4 : 3)] ?? 0;
}

/**
 * Rebuilds visual lines from positioned text items (pdf.js coordinates: origin bottom-left).
 * Items whose baselines are within ~40% of the font height share a line. Gaps wider than 3× the
 * font size become tabs; lines starting right of 45% of the page width are prefixed with a tab.
 */
export function linesFromPositionedText(items: PositionedText[], pageWidth: number): string[] {
  const visible = items.filter((i) => i.str.trim().length > 0);
  const rows: { y: number; height: number; items: PositionedText[] }[] = [];
  for (const item of [...visible].sort((a, b) => b.y - a.y)) {
    const tolerance = Math.max(2, 0.4 * Math.max(item.height, 1));
    const row = rows.find((r) => Math.abs(r.y - item.y) <= Math.max(tolerance, 0.4 * r.height));
    if (row) {
      row.items.push(item);
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] });
    }
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => {
    const cells = row.items.sort((a, b) => a.x - b.x);
    let line = cells[0]!.x > pageWidth * 0.45 ? "\t" : "";
    let previousEnd: number | null = null;
    for (const cell of cells) {
      if (previousEnd !== null) {
        const gap = cell.x - previousEnd;
        line += gap > 3 * Math.max(cell.height, 6) ? "\t" : gap > 0.15 * Math.max(cell.height, 6) ? " " : "";
      }
      line += cell.str.trim();
      previousEnd = cell.x + cell.width;
    }
    return line;
  });
}

function cellsOf(line: string): string[] {
  return line.split(CELL_SPLIT).map((c) => c.trim());
}

function normaliseText(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[   ]/g, " ").replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
}

/** Parses a date in common Indian invoice formats into ISO yyyy-mm-dd. */
export function parseInvoiceDate(input: string): string | undefined {
  for (const { regex, read } of DATE_PATTERNS) {
    const match = input.match(regex);
    if (!match) continue;
    const [year, month, day] = read(match);
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return undefined;
}

/** Last monetary amount in a string, ignoring percentages; returned as a decimal rupee string. */
export function parseAmount(input: string): string | undefined {
  const cleaned = input.replace(PERCENT, " ");
  let last: string | undefined;
  for (const match of cleaned.matchAll(AMOUNT)) last = match[1];
  if (!last) return undefined;
  const paise = parseRupeesToPaise(last);
  return paise === null || paise <= 0n ? undefined : paiseToDecimalString(paise);
}

function amountAfter(lines: string[], labels: RegExp[], exclude?: RegExp): string | undefined {
  for (const label of labels) {
    for (const line of lines) {
      if (exclude?.test(line)) continue;
      const match = line.match(label);
      if (match?.index === undefined) continue;
      const value = parseAmount(line.slice(match.index + match[0].length));
      if (value) return value;
    }
  }
  return undefined;
}

function dateAfter(lines: string[], label: RegExp, exclude?: RegExp): string | undefined {
  for (const [index, line] of lines.entries()) {
    const match = line.match(label);
    if (match?.index === undefined || exclude?.test(line)) continue;
    const value = parseInvoiceDate(line.slice(match.index + match[0].length)) ?? parseInvoiceDate(lines[index + 1] ?? "");
    if (value) return value;
  }
  return undefined;
}

function findInvoiceNumber(lines: string[]): string | undefined {
  const label = /\b(?:invoice|inv|bill)\s*(?:no\.?|number|num\.?|#)\s*[:.#-]?\s*/i;
  for (const [index, line] of lines.entries()) {
    const match = line.match(label);
    if (match?.index === undefined) continue;
    const candidates = [line.slice(match.index + match[0].length), lines[index + 1] ?? ""];
    for (const candidate of candidates) {
      const token = cellsOf(candidate)
        .flatMap((c) => c.split(/\s+/))
        .map((t) => t.replace(/^[:#]+|[.,;:]+$/g, ""))
        .find((t) => /^[A-Za-z0-9][A-Za-z0-9/_.-]{2,39}$/.test(t) && /\d/.test(t) && !parseInvoiceDate(t));
      if (token) return token;
    }
  }
  return undefined;
}

function sanitiseName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/^[:\-–\s]+|[:\-–\s]+$/g, "").replace(/\s{2,}/g, " ");
  if (cleaned.length < 3 || !/[A-Za-z]{3}/.test(cleaned)) return undefined;
  return cleaned;
}

const SUPPLIER_HEADER = /\b(supplier|seller|service\s+provider|billed\s+by|from)\b/i;
const RECIPIENT_HEADER = /\b(bill(?:ed)?\s*to|buyer|recipient|customer|client)\b/i;
const BLOCK_END = /^(project|#|description|sl\.?\s*no|s\.?\s*no|particulars|sr\.?\s*no)\b/i;
const FIELD_LABEL = /^(gstin|pan|rera|email|e-mail|phone|tel|mobile|cin|state)\b/i;

interface PartyBlocks {
  supplier: string[];
  recipient: string[];
}

/**
 * Splits a line at the whitespace run closest to a character column, for OCR text whose columns
 * are separated by variable spacing. Returns [left, right]; either side may be empty.
 */
function splitAtColumn(line: string, column: number): [string, string] {
  let best: { start: number; end: number } | null = null;
  for (const match of line.matchAll(/\s{2,}/g)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (Math.abs(end - column) > 16) continue;
    if (!best || Math.abs(end - column) < Math.abs(best.end - column)) best = { start, end };
  }
  if (best) return [line.slice(0, best.start).trim(), line.slice(best.end).trim()];
  const indent = line.length - line.trimStart().length;
  return indent >= column * 0.6 ? ["", line.trim()] : [line.trim(), ""];
}

/** Splits the two-column "Supplier | Bill to" block into per-party lines. */
function partyBlocks(lines: string[]): PartyBlocks | null {
  const headerIndex = lines.findIndex((line) => {
    const cells = cellsOf(line).filter(Boolean);
    return cells.length >= 2 && SUPPLIER_HEADER.test(cells[0]!) && RECIPIENT_HEADER.test(cells.slice(1).join(" "));
  });
  if (headerIndex < 0) return partyBlocksByColumn(lines);
  const blocks: PartyBlocks = { supplier: [], recipient: [] };
  for (const line of lines.slice(headerIndex + 1, headerIndex + 16)) {
    const cells = cellsOf(line);
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length === 0) continue;
    if (cells[0] && BLOCK_END.test(cells[0])) break;
    if (cells[0] === "") blocks.recipient.push(nonEmpty.join(" "));
    else if (nonEmpty.length >= 2) {
      blocks.supplier.push(nonEmpty[0]!);
      blocks.recipient.push(nonEmpty.slice(1).join(" "));
    } else blocks.supplier.push(nonEmpty[0]!);
  }
  return blocks;
}

function partyBlocksByColumn(lines: string[]): PartyBlocks | null {
  const headerIndex = lines.findIndex((line) => {
    const supplier = line.match(SUPPLIER_HEADER);
    const recipient = line.match(RECIPIENT_HEADER);
    return supplier?.index !== undefined && recipient?.index !== undefined && supplier.index < 4 && recipient.index > supplier.index + 8;
  });
  if (headerIndex < 0) return null;
  const column = lines[headerIndex]!.match(RECIPIENT_HEADER)!.index!;
  const blocks: PartyBlocks = { supplier: [], recipient: [] };
  for (const line of lines.slice(headerIndex + 1, headerIndex + 16)) {
    if (BLOCK_END.test(line.trim())) break;
    const [left, right] = splitAtColumn(line, column);
    if (left) blocks.supplier.push(left);
    if (right) blocks.recipient.push(right);
  }
  return blocks;
}

function nameFromBlock(block: string[]): string | undefined {
  const [first, second] = block;
  if (!first || FIELD_LABEL.test(first)) return undefined;
  const continues = second && !FIELD_LABEL.test(second) && !/[\d,]/.test(second) && (second.startsWith("(") || second.split(/\s+/).length <= 3);
  return sanitiseName(continues ? `${first} ${second}` : first);
}

function gstinsIn(text: string): string[] {
  const found = (text.toUpperCase().match(GSTIN_LOOSE) ?? []).map((g) => `${g.slice(0, 13)}Z${g.slice(14)}`);
  return [...new Set(found)];
}

function labelledValue(lines: string[], label: RegExp): string | undefined {
  for (const [index, line] of lines.entries()) {
    const match = line.match(label);
    if (match?.index === undefined) continue;
    const rest = cellsOf(line.slice(match.index + match[0].length)).find(Boolean);
    const next = cellsOf(lines[index + 1] ?? "").find(Boolean);
    const value = [rest, next].map(sanitiseName).find((v) => v && !FIELD_LABEL.test(v) && !/\binvoice\b/i.test(v));
    if (value) return value;
  }
  return undefined;
}

/** Extracts invoice fields from reconstructed document text. Missing fields are left undefined. */
export function parseInvoiceText(text: string): ExtractedInvoiceFields {
  const lines = normaliseText(text);
  const joined = lines.join("\n");
  const result: ExtractedInvoiceFields = { gstins: gstinsIn(joined) };

  result.invoiceNumber = findInvoiceNumber(lines);
  result.invoiceDate =
    dateAfter(lines, /\b(?:invoice|bill)\s*date\b|\bdate\s+of\s+(?:invoice|issue)\b|\bdated\b/i) ??
    dateAfter(lines, /\bdate\b/i, /\bdue\b|\bsupply\b/i);
  result.dueDate = dateAfter(lines, /\bdue\s*(?:date|on)\b|\bpayment\s+due\b/i);

  const blocks = partyBlocks(lines);
  if (blocks) {
    result.supplierName = nameFromBlock(blocks.supplier);
    result.builderName = nameFromBlock(blocks.recipient);
    result.supplierGstin = gstinsIn(blocks.supplier.join("\n"))[0];
    result.builderGstin = gstinsIn(blocks.recipient.join("\n"))[0];
  }
  result.supplierName ??=
    labelledValue(lines, /\baccount\s+(?:holder\s+)?name\b\s*[:\-]?/i) ??
    sanitiseName(cellsOf(lines[0] ?? "").find(Boolean)?.replace(/\b(?:tax\s+)?invoice\b.*$/i, ""));
  result.builderName ??= labelledValue(lines, /(?:^|\t| {2,})\s*(?:bill(?:ed)?\s*to|buyer|recipient|customer)\b(?:\s*\([^)]*\))?\s*[:\-]?/i);

  if (!result.supplierGstin || !result.builderGstin) {
    for (const line of lines) {
      const found = gstinsIn(line);
      if (found.length >= 2) {
        result.supplierGstin ??= found[0];
        result.builderGstin ??= found[1];
        break;
      }
      if (found.length === 1 && /\b(buyer|recipient|customer|bill(?:ed)?\s*to)\b/i.test(line)) result.builderGstin ??= found[0];
      if (found.length === 1 && /\b(supplier|seller|our)\b/i.test(line)) result.supplierGstin ??= found[0];
    }
    const remaining = result.gstins.filter((g) => g !== result.supplierGstin && g !== result.builderGstin);
    if (!result.supplierGstin && remaining.length) result.supplierGstin = remaining.shift();
    if (!result.builderGstin && remaining.length) result.builderGstin = remaining.shift();
  }

  result.taxableAmount = amountAfter(lines, [/\btaxable\s+(?:value|amount)\b/i, /\bassessable\s+value\b/i, /\bsub\s*-?\s*total\b/i]);
  result.cgstAmount = amountAfter(lines, [/\b(?:cgst|central\s+tax)\b/i]);
  result.sgstAmount = amountAfter(lines, [/\b(?:sgst|utgst|state\s+tax)\b/i]);
  result.igstAmount = amountAfter(lines, [/\b(?:igst|integrated\s+tax)\b/i]);
  result.totalAmount = amountAfter(
    lines,
    [
      /\btotal\s+invoice\s+(?:value|amount)\b/i,
      /\bgrand\s+total\b/i,
      /\binvoice\s+(?:total|value)\b/i,
      /\btotal\s+amount(?:\s+payable)?\b/i,
      /\b(?:net\s+)?amount\s+payable\b/i,
      /\btotal\s*\(?\s*incl/i,
      /\btotal\b/i,
    ],
    /\btotal\s+(?:tax|gst)\b|\bin\s+words\b/i,
  );

  const toPaise = (v?: string) => (v ? parseRupeesToPaise(v) : null);
  const taxParts = [result.cgstAmount, result.sgstAmount, result.igstAmount].map(toPaise).filter((v): v is bigint => v !== null);
  let tax: bigint | null = taxParts.length ? taxParts.reduce((a, b) => a + b, 0n) : null;
  if (tax === null) {
    const stated = amountAfter(lines, [/\btotal\s+(?:tax|gst)\b/i, /\b(?:tax|gst)\s+amount\b/i, /\bgst\b/i]);
    tax = toPaise(stated);
  }
  const taxable = toPaise(result.taxableAmount);
  let total = toPaise(result.totalAmount);
  if (total === null && taxable !== null && tax !== null) total = taxable + tax;
  if (tax === null && taxable !== null && total !== null && total > taxable) tax = total - taxable;

  if (tax !== null && tax > 0n) result.taxAmount = paiseToDecimalString(tax);
  if (total !== null && total > 0n) result.totalAmount = paiseToDecimalString(total);
  if (taxable !== null && tax !== null && total !== null) {
    const diff = taxable + tax - total;
    result.amountsReconcile = diff >= -100n && diff <= 100n;
  }

  Object.assign(result, compact(brokerageParticulars(lines)));
  return result;
}

function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The first cell after a label on the same line: "Label: value\tnext cell" → "value". */
function cellAfter(line: string, match: RegExpMatchArray): string {
  return cellsOf(line.slice(match.index! + match[0].length).replace(/^[\s:.\-–#]+/, ""))[0] ?? "";
}

function findLabelled<T>(lines: string[], label: RegExp, read: (cell: string) => T | undefined, lookAhead = false): T | undefined {
  for (const [index, line] of lines.entries()) {
    const match = line.match(label);
    if (match?.index === undefined) continue;
    const value = read(cellAfter(line, match)) ?? (lookAhead ? read(cellsOf(lines[index + 1] ?? "").find(Boolean) ?? "") : undefined);
    if (value !== undefined) return value;
  }
  return undefined;
}

const STATE_NAMES = Object.entries(GST_STATE_CODES).sort(([, a], [, b]) => b.length - a.length);

function stateCodeIn(cell: string): string | undefined {
  const code = cell.match(/\((\d{2})\)/)?.[1] ?? cell.match(/^(\d{2})(?!\d)/)?.[1];
  if (code) return code in GST_STATE_CODES ? code : undefined;
  const lower = cell.toLowerCase();
  return STATE_NAMES.find(([, name]) => lower.includes(name.toLowerCase()))?.[0];
}

function findIrn(lines: string[]): string | undefined {
  for (const [index, line] of lines.entries()) {
    const match = line.match(/\bIRN\b\s*(?:no\.?|number)?\s*[:.\-]?/i);
    if (match?.index === undefined) continue;
    // The 64-character IRN often wraps onto the next line.
    const tail = `${line.slice(match.index + match[0].length)}${lines[index + 1] ?? ""}`.replace(/\s+/g, "");
    const hex = tail.match(/^[0-9a-f]{64}/i);
    if (hex) return hex[0].toLowerCase();
  }
  return lines.join("\n").match(/\b[0-9a-f]{64}\b/i)?.[0].toLowerCase();
}

function gstRateBps(lines: string[]): number | undefined {
  for (const line of lines) {
    const match = line.match(/\b(cgst|sgst|utgst|igst)\b[^%\n\t]*?(\d{1,2}(?:\.\d{1,2})?)\s*%/i);
    if (!match) continue;
    const bps = parsePercentToBps(match[2]!);
    if (bps === null || bps <= 0) continue;
    const total = match[1]!.toLowerCase() === "igst" ? bps : bps * 2;
    if (total <= 4000) return total;
  }
  return undefined;
}

const TOWER = /\b(tower|wing|block)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9-]{0,9})\b/i;
const UNIT = /\b(?:units?|flats?|apartments?|apt\.?|villas?|plots?|shops?)\s*(?:no\.?)?\s*[:\-#]?\s*([A-Za-z0-9][A-Za-z0-9/-]{0,14})/gi;
const INITIALS = /^([A-Z](?:[.\s]?[A-Z]){0,3})\.?(?![A-Za-z])/;

function towerIn(text: string): string | undefined {
  const match = text.match(TOWER);
  if (!match) return undefined;
  const kind = match[1]!.toLowerCase();
  return kind === "tower" ? match[2] : `${kind[0]!.toUpperCase()}${kind.slice(1)} ${match[2]}`;
}

function unitIn(text: string): string | undefined {
  for (const match of text.matchAll(UNIT)) {
    if (/\d/.test(match[1]!)) return match[1];
  }
  return undefined;
}

function initialsAfter(text: string, label: RegExp): string | undefined {
  const match = text.match(label);
  if (match?.index === undefined) return undefined;
  const initials = text.slice(match.index + match[0].length).match(INITIALS)?.[1];
  return initials?.replace(/[.\s]/g, "");
}

/** Booking, agreement, e-invoice and place-of-supply details printed on a brokerage invoice. */
function brokerageParticulars(lines: string[]) {
  const booking = findLabelled(lines, /\bbooking(?:\s+(?:ref(?:erence)?|details))?\s*[:\-]/i, (cell) => (cell ? cell : undefined));
  // Without a booking label, look only below the parties so addresses are never read as units.
  const bodyStart = lines.findIndex((l) => /\b(project|description|particulars)\b/i.test(l));
  const body = bodyStart >= 0 ? lines.slice(bodyStart).join("\n") : "";
  const brokerage = lines.map((l) => l.match(/\bbrokerage\b[^%\n\t]{0,20}?(\d{1,2}(?:\.\d{1,2})?)\s*%/i)?.[1]).find(Boolean);
  const brokerageBps = brokerage ? parsePercentToBps(brokerage) : null;
  const tds = lines.map((l) => l.match(/\bTDS\b[^%\n\t]{0,24}?(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*%/i)?.[1]).find(Boolean);
  const tdsBps = tds ? parsePercentToBps(tds) : null;

  return {
    gstRateBps: gstRateBps(lines),
    placeOfSupplyStateCode: findLabelled(lines, /\bplace\s+of\s+supply\b/i, (cell) => (cell ? stateCodeIn(cell) : undefined), true),
    irn: findIrn(lines),
    ackNumber: findLabelled(lines, /\back(?:nowledge?ment)?\.?\s*(?:no|number)\b\.?/i, (cell) => cell.replace(/\s+/g, "").match(/^\d{15}(?!\d)/)?.[0], true),
    ackDate: dateAfter(lines, /\back(?:nowledge?ment)?\.?\s*date\b/i),
    bookingTower: booking ? towerIn(booking) : towerIn(body),
    bookingUnit: booking ? unitIn(booking) : unitIn(body),
    buyerInitials: (booking ? initialsAfter(booking, /\bbuyer(?:'s)?(?:\s+initials)?\s*[:\-]?\s*/i) : undefined) ?? findLabelled(lines, /\bbuyer(?:'s)?\s+initials?\s*[:\-]?/i, (cell) => cell.match(INITIALS)?.[1]?.replace(/[.\s]/g, "")),
    agreementRegistrationNumber: findLabelled(lines, /\bagreement\s+(?:for\s+sale|(?:reg(?:istration|n)?\.?\s*)?(?:no|number)\b)\.?/i, (cell) =>
      cell
        .split(/\s+/)
        .map((t) => t.replace(/[.,;:]+$/, ""))
        .find((t) => /^[A-Za-z0-9][A-Za-z0-9/._-]{2,39}$/.test(t) && /\d/.test(t) && !parseInvoiceDate(t)),
    ),
    agreementDate: dateAfter(lines, /\bagreement\s+date\b|\bdate\s+of\s+(?:agreement|registration)\b|\bregistered\s+on\b/i),
    agreementValue: findLabelled(lines, /(?<!\bof\s)\b(?:agreement|sale)\s+(?:value|consideration)\b|\bconsideration\s+value\b/i, (cell) => parseAmount(cell)),
    agreementBrokerageRate: brokerageBps && brokerageBps > 0 && brokerageBps <= 1000 ? formatBps(brokerageBps, { suffix: false }) : undefined,
    tdsRate: tdsBps !== null && tdsBps <= 2000 ? formatBps(tdsBps, { suffix: false }) : undefined,
  } satisfies Partial<ExtractedInvoiceFields>;
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL_NOISE, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Similarity of two organisation names after dropping legal suffixes (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Picks the builder whose GSTIN appears on the document, else the closest name match. */
export function matchBuilder(fields: ExtractedInvoiceFields, builders: BuilderCandidate[]): BuilderMatch | null {
  const gstins = new Set([fields.builderGstin, ...fields.gstins].filter(Boolean).map((g) => g!.toUpperCase()));
  const byGstin = builders.find((b) => b.gstin && gstins.has(b.gstin.toUpperCase()));
  if (byGstin) return { id: byGstin.id, by: "gstin" };
  if (!fields.builderName) return null;
  let best: { id: string; score: number } | null = null;
  for (const builder of builders) {
    const score = Math.max(nameSimilarity(fields.builderName, builder.name), builder.legalName ? nameSimilarity(fields.builderName, builder.legalName) : 0);
    if (score >= 0.6 && (!best || score > best.score)) best = { id: builder.id, score };
  }
  return best ? { id: best.id, by: "name" } : null;
}

/** Finds a project mentioned in the document by its code in brackets or its full name. */
export function matchProject(text: string, projects: ProjectCandidate[]): string | null {
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const byCode = projects.find((p) => haystack.includes(`(${p.code.toLowerCase()})`));
  if (byCode) return byCode.id;
  const byName = projects.find((p) => haystack.includes(p.name.toLowerCase()));
  return byName?.id ?? null;
}

/** True when the recovered text is too sparse to be a digital (non-scanned) invoice. */
export function isTextSparse(text: string): boolean {
  return text.replace(/\s+/g, "").length < 40;
}
