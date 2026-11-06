/**
 * E-invoice (IRP) identifiers. Format checks only: whether an IRN is registered on the IRP is an
 * online check performed by a verification connector.
 */

/** IRN: SHA-256 hex digest (64 characters) issued by the Invoice Registration Portal. */
export const IRN_PATTERN = /^[0-9a-f]{64}$/;
/** IRP acknowledgement number: 15 digits. */
export const ACK_NUMBER_PATTERN = /^\d{15}$/;

export function normaliseIrn(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, "").toLowerCase();
  return cleaned ? cleaned : null;
}

export function isIrnFormat(value: string | null | undefined): boolean {
  const irn = normaliseIrn(value);
  return irn !== null && IRN_PATTERN.test(irn);
}

export function isAckNumberFormat(value: string | null | undefined): boolean {
  return typeof value === "string" && ACK_NUMBER_PATTERN.test(value.trim());
}

/** Shortened IRN for display, e.g. "3f9a…c21b". */
export function shortIrn(irn: string): string {
  return irn.length > 12 ? `${irn.slice(0, 6)}…${irn.slice(-6)}` : irn;
}
