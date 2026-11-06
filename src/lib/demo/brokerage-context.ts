/**
 * Booking, agreement and e-invoice particulars for demonstration invoices. Shared by the seed
 * (stored on the invoice) and the sample PDF renderer (printed on the document), so the uploaded
 * sample and the seeded record always agree. Values are deterministic per invoice number.
 */
import { createHash } from "node:crypto";
import { deriveIrn } from "../invoice-integrity/fingerprint";
import { applyBps } from "../invoice-integrity/consistency";
import { splitGstInclusive } from "../pdf/brokerage-invoice";

export interface DemoBrokerageContext {
  bookingTower: string;
  bookingUnit: string;
  buyerInitials: string;
  agreementRegistrationNumber: string;
  /** ISO yyyy-mm-dd */
  agreementDate: string;
  agreementValuePaise: bigint;
  agreementBrokerageBps: number;
  tdsRateBps: number;
  eInvoice: { irn: string; ackNumber: string; ackDate: string } | null;
}

/** Hand-picked particulars matching each dataset invoice's description. */
const KNOWN: Record<string, { tower: string; unit: string; initials: string; office: string }> = {
  "GFH/2026/001": { tower: "B", unit: "1104", initials: "RK", office: "HVL-2" },
  "GFH/2026/002": { tower: "A", unit: "0704", initials: "SM", office: "HVL-2" },
  "GFH/2026/003": { tower: "R", unit: "G07", initials: "VP", office: "HVL-2" },
  "GHZ/2026/014": { tower: "Wing C", unit: "2401", initials: "AJ", office: "BOM-6" },
  "RGD/2026/007": { tower: "RG", unit: "118", initials: "NR", office: "SJP-1" },
  "UNA/GFH/2026/031": { tower: "C", unit: "0405", initials: "PD", office: "HVL-2" },
  "UNA/GHZ/2026/009": { tower: "Wing A", unit: "1806", initials: "MK", office: "BOM-6" },
  "UNA/RGD/2026/004": { tower: "RG", unit: "044", initials: "TS", office: "SJP-1" },
  "UNA/SBV/2026/002": { tower: "SB", unit: "12", initials: "LF", office: "BDZ-1" },
  "WRP/2026/014": { tower: "A", unit: "1204", initials: "HS", office: "BRL-4" },
  "WRP/2026/015": { tower: "Wing B", unit: "0903", initials: "KG", office: "BRL-4" },
  "WRP/2026/016": { tower: "B", unit: "1802", initials: "DN", office: "BRL-4" },
  "WRP/2026/017": { tower: "Wing A", unit: "2104", initials: "RP", office: "BRL-4" },
};

const INITIALS = ["AK", "BS", "CR", "DM", "EP", "GN", "HK", "JV", "KS", "LR", "MP", "NS"];
const DAY_MS = 24 * 60 * 60 * 1000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Brokerage rate quoted in the description ("Brokerage @ 2.5% of agreement value"), else 2%. */
function quotedBrokerageBps(detail: string | undefined): number {
  const match = detail?.match(/@\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  if (!match) return 200;
  const [whole, fraction = ""] = match[1]!.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function demoBrokerageContext(input: {
  invoiceNumber: string;
  invoiceDate: string;
  amountPaise: bigint;
  gstRatePercent: number;
  supplierGstin?: string | null;
  detail?: string;
  /** Issue an e-invoice IRN for this invoice (large suppliers must e-invoice). */
  eInvoice?: boolean;
}): DemoBrokerageContext {
  const seed = digest(input.invoiceNumber);
  const known = KNOWN[input.invoiceNumber];
  const invoiceDate = new Date(`${input.invoiceDate}T00:00:00.000Z`);
  const bps = quotedBrokerageBps(input.detail);
  const taxable = splitGstInclusive(input.amountPaise, input.gstRatePercent, "INTRA").taxablePaise;
  // Agreement value rounded down to ₹100, so the stated rate reproduces the taxable value within a few rupees.
  const agreementValuePaise = ((taxable * 10_000n) / BigInt(bps) / 10_000n) * 10_000n;
  const agreementDate = new Date(invoiceDate.getTime() - (12 + (seed[0]! % 40)) * DAY_MS);
  const office = known?.office ?? `SRO-${1 + (seed[1]! % 9)}`;
  const serial = 1000 + ((seed[2]! << 8) + seed[3]!) % 9000;

  let eInvoice: DemoBrokerageContext["eInvoice"] = null;
  if (input.eInvoice && input.supplierGstin) {
    const ackDate = new Date(invoiceDate.getTime() + (seed[4]! % 2) * DAY_MS);
    eInvoice = {
      irn: deriveIrn(input.supplierGstin, invoiceDate, input.invoiceNumber),
      ackNumber: `1120${String(seed.readUInt32BE(5) % 100_000_000_000).padStart(11, "0")}`,
      ackDate: isoDay(ackDate),
    };
  }

  return {
    bookingTower: known?.tower ?? String.fromCharCode(65 + (seed[6]! % 6)),
    bookingUnit: known?.unit ?? `${String(2 + (seed[7]! % 28)).padStart(2, "0")}0${1 + (seed[8]! % 6)}`,
    buyerInitials: known?.initials ?? INITIALS[seed[9]! % INITIALS.length]!,
    agreementRegistrationNumber: `${office}/${serial}/${agreementDate.getUTCFullYear()}`,
    agreementDate: isoDay(agreementDate),
    agreementValuePaise,
    agreementBrokerageBps: bps,
    tdsRateBps: 200,
    eInvoice,
  };
}

/** The brokerage the agreement implies, for display and checks. */
export function demoAgreedBrokeragePaise(context: DemoBrokerageContext): bigint {
  return applyBps(context.agreementValuePaise, context.agreementBrokerageBps);
}
