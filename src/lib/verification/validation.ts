/**
 * Pure format validation for Indian business identifiers. Safe to import from client components,
 * server code, scripts and the seed.
 */

const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GST state and union-territory codes (CBIC). 97 = other territory, 99 = centre jurisdiction. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
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
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (before reorganisation)",
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
  "99": "Centre Jurisdiction",
};

/** PAN fourth character: the holder's constitution. */
export const PAN_HOLDER_TYPES: Readonly<Record<string, string>> = {
  P: "Individual",
  C: "Company",
  H: "Hindu Undivided Family",
  F: "Firm or LLP",
  A: "Association of Persons",
  T: "Trust",
  B: "Body of Individuals",
  L: "Local Authority",
  J: "Artificial Juridical Person",
  G: "Government",
  E: "Limited Liability Partnership",
};

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{3}[ABCEFGHJLPT][A-Z]\d{4}[A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_PATTERN = /^\d{9,18}$/;
const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const IRN_PATTERN = /^[0-9a-f]{64}$/;
const MAHARERA_AGENT_PATTERN = /^A5\d{10}$/;
const RERA_GENERIC_PATTERN = /^[A-Z0-9][A-Z0-9/-]{5,39}$/;

export type ValidationResult<T extends string = string> = { ok: true; value: T } | { ok: false; error: string };

const compact = (input: string) => input.replace(/[\s-]/g, "").toUpperCase();

/** GSTIN check character (mod-36 weighted sum over the first 14 characters). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARSET.indexOf(first14[i]!);
    if (value < 0) throw new Error("GSTIN contains an invalid character");
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36]!;
}

export function validateGstin(input: string): ValidationResult {
  const value = compact(input);
  if (value.length !== 15) return { ok: false, error: "A GSTIN has 15 characters." };
  if (!GSTIN_PATTERN.test(value)) return { ok: false, error: "Enter a GSTIN in the format 27ABCDE1234F1Z5." };
  if (!GST_STATE_CODES[value.slice(0, 2)]) return { ok: false, error: "The GSTIN starts with an unknown state code." };
  if (!PAN_PATTERN.test(value.slice(2, 12))) return { ok: false, error: "The GSTIN does not contain a valid PAN." };
  if (gstinCheckCharacter(value.slice(0, 14)) !== value[14]) return { ok: false, error: "The GSTIN check digit does not match. Check for typing errors." };
  return { ok: true, value };
}

export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12);
}

export function gstStateName(gstin: string): string | null {
  return GST_STATE_CODES[gstin.slice(0, 2)] ?? null;
}

export function validatePan(input: string): ValidationResult {
  const value = compact(input);
  if (value.length !== 10) return { ok: false, error: "A PAN has 10 characters." };
  if (!PAN_PATTERN.test(value)) return { ok: false, error: "Enter a PAN in the format ABCDE1234F." };
  return { ok: true, value };
}

export function panHolderType(pan: string): string | null {
  return PAN_HOLDER_TYPES[pan[3] ?? ""] ?? null;
}

export function validateIfsc(input: string): ValidationResult {
  const value = input.replace(/\s/g, "").toUpperCase();
  if (value.length !== 11) return { ok: false, error: "An IFSC has 11 characters." };
  if (!IFSC_PATTERN.test(value)) return { ok: false, error: "Enter an IFSC in the format ABCD0123456 (the fifth character is zero)." };
  return { ok: true, value };
}

export function validateAccountNumber(input: string): ValidationResult {
  const value = input.replace(/\s/g, "");
  if (!ACCOUNT_PATTERN.test(value)) return { ok: false, error: "Enter the account number as 9 to 18 digits." };
  if (/^0+$/.test(value)) return { ok: false, error: "Enter a valid account number." };
  return { ok: true, value };
}

export function validateUdyam(input: string): ValidationResult {
  const value = input.replace(/\s/g, "").toUpperCase();
  if (!UDYAM_PATTERN.test(value)) return { ok: false, error: "Enter the Udyam number in the format UDYAM-MH-12-1234567." };
  return { ok: true, value };
}

/** IRN: the 64-character hexadecimal hash issued by the Invoice Registration Portal. */
export function validateIrn(input: string): ValidationResult {
  const value = input.trim().toLowerCase();
  if (!IRN_PATTERN.test(value)) return { ok: false, error: "An IRN is 64 hexadecimal characters." };
  return { ok: true, value };
}

export function isMahaReraAgentNumber(value: string): boolean {
  return MAHARERA_AGENT_PATTERN.test(value);
}

export function validateReraAgentNumber(input: string): ValidationResult {
  const value = input.replace(/\s/g, "").toUpperCase();
  if (!RERA_GENERIC_PATTERN.test(value)) return { ok: false, error: "Enter the RERA agent registration number exactly as on the certificate." };
  return { ok: true, value };
}

/** Throws with the validation message; for code paths that have already validated user input. */
export function requireValid(result: ValidationResult): string {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
