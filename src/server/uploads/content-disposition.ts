/**
 * Content-Disposition header with an ASCII fallback filename and an RFC 5987 UTF-8 filename.
 * Quotes, backslashes, control characters and path separators never reach the header.
 */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const cleaned = fileName.replace(/[\u0000-\u001f\u007f"\\/]/g, "").trim() || "invoice.pdf";
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
