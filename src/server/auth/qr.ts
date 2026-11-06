import "server-only";
import qrcode from "qrcode-generator";

export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** SVG path data with one 1×1 square per dark module, in module units. */
  path: string;
}

/** Encodes text as a QR code (error correction M) for rendering as an inline SVG on the server. */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return { size, path: parts.join("") };
}
