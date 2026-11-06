/** Display masks for identifiers. Masked values are safe for logs, audit metadata and the interface. */

const MASK = "•";

function keepEnds(value: string, head: number, tail: number): string {
  if (value.length <= head + tail) return MASK.repeat(value.length);
  return `${value.slice(0, head)}${MASK.repeat(value.length - head - tail)}${value.slice(value.length - tail)}`;
}

/** ABCDE1234F → AB•••••34F */
export function maskPan(pan: string): string {
  return keepEnds(pan.toUpperCase(), 2, 3);
}

/** 27ABCDE1234F1Z5 → 27AB•••••••1Z5: state code and entity suffix stay readable. */
export function maskGstin(gstin: string): string {
  return keepEnds(gstin.toUpperCase(), 4, 3);
}

/** 500100099005 → ••••••••9005 */
export function maskAccountNumber(account: string): string {
  return keepEnds(account, 0, 4);
}

export function lastFour(account: string): string {
  return account.slice(-4);
}

/** UDYAM-MH-12-1234567 → UDYAM-MH-12-•••4567 */
export function maskUdyam(udyam: string): string {
  const parts = udyam.split("-");
  if (parts.length !== 4) return keepEnds(udyam, 6, 4);
  return `${parts.slice(0, 3).join("-")}-${keepEnds(parts[3]!, 0, 4)}`;
}

export function maskIrn(irn: string): string {
  return `${irn.slice(0, 8)}…${irn.slice(-6)}`;
}
