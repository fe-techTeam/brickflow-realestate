/** GST reference data and helpers. Pure functions; safe in the browser and on the server. */

/** GST state and union-territory codes (first two characters of a GSTIN). */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST slabs in basis points, including the 2025 rationalised slabs and earlier rates still seen on older invoices. */
export const GST_RATES_BPS = [0, 25, 300, 500, 1200, 1800, 2800, 4000] as const;

export function normaliseGstin(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return cleaned ? cleaned : null;
}

export function isGstinFormat(value: string | null | undefined): boolean {
  const gstin = normaliseGstin(value);
  return gstin !== null && GSTIN_FORMAT.test(gstin) && gstin.slice(0, 2) in GST_STATE_CODES;
}

/** The two-digit state code of a GSTIN, or null when it is missing or malformed. */
export function gstinStateCode(value: string | null | undefined): string | null {
  const gstin = normaliseGstin(value);
  if (!gstin || !/^\d{2}/.test(gstin)) return null;
  const code = gstin.slice(0, 2);
  return code in GST_STATE_CODES ? code : null;
}

export function isStateCode(value: string | null | undefined): value is string {
  return typeof value === "string" && value in GST_STATE_CODES;
}

export function stateName(code: string | null | undefined): string | null {
  return code && code in GST_STATE_CODES ? GST_STATE_CODES[code]! : null;
}

export type SupplyMode = "INTRA" | "INTER";

/**
 * Intra-state when the supplier's state equals the place of supply (CGST + SGST), otherwise
 * inter-state (IGST). The place of supply defaults to the recipient's GSTIN state.
 */
export function supplyMode(supplierStateCode: string | null, placeOfSupplyStateCode: string | null): SupplyMode | null {
  if (!supplierStateCode || !placeOfSupplyStateCode) return null;
  return supplierStateCode === placeOfSupplyStateCode ? "INTRA" : "INTER";
}

/** Indian financial year label (April–March) for a date, e.g. "2026-27". */
export function financialYear(date: Date): string {
  const year = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}
