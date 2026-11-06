export type CsvCell = string | number | bigint | null | undefined;

/**
 * RFC 4180 escaping. Text cells that a spreadsheet would evaluate as a formula (leading = + - @ tab or
 * CR) are prefixed with an apostrophe to prevent CSV injection.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

/** UTF-8 byte order mark so spreadsheet software detects the encoding. */
export const CSV_BOM = "﻿";
