/**
 * Fictional demonstration datasets. Shared by the database seed, the sign-in page and the
 * sample-document download so all of them always describe the same data.
 *
 * `DEMO_DATASET` selects the dataset (default `standard`, which the automated tests rely on).
 */
import type { BrokerageInvoiceData } from "../pdf/brokerage-invoice";
import { demoBrokerageContext, type DemoBrokerageContext } from "./brokerage-context";
import { chandakDataset } from "./datasets/chandak";
import { STANDARD_ORGANISATIONS, STANDARD_PROJECTS, STANDARD_SAMPLES, standardDataset } from "./datasets/standard";
import type { DemoClock, DemoDataset, DemoInvoiceDocument, DemoOrganisation } from "./types";

export type { DemoClock, DemoDataset, DemoInvoiceDocument, DemoOrganisation } from "./types";

export const DEMO_DATASETS = { standard: standardDataset, chandak: chandakDataset } as const satisfies Record<string, DemoDataset>;
export type DemoDatasetKey = keyof typeof DEMO_DATASETS;

export function resolveDemoDataset(key: string | undefined = process.env.DEMO_DATASET): DemoDataset {
  if (!key) return standardDataset;
  const dataset = (DEMO_DATASETS as Record<string, DemoDataset>)[key];
  if (!dataset) throw new Error(`Unknown DEMO_DATASET "${key}". Expected one of: ${Object.keys(DEMO_DATASETS).join(", ")}`);
  return dataset;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

export function demoClock(now: Date = new Date()): DemoClock {
  return {
    now,
    daysAgo: (days, hour = 11) => new Date(now.getTime() - days * DAY_MS + (hour - 12) * 60 * 60 * 1000),
    isoDate: (offsetDays) => IST_DATE.format(new Date(now.getTime() + offsetDays * DAY_MS)),
  };
}

/** Standard-dataset exports with literal keys, used by the automated tests. */
export const DEMO_ORGANISATIONS = STANDARD_ORGANISATIONS;
export type DemoOrgKey = keyof typeof STANDARD_ORGANISATIONS;
export type DemoBuilderKey = "godrej" | "skyline" | "coastal";
export type DemoCpKey = "prestige" | "urbannest";
export const DEMO_PROJECTS = STANDARD_PROJECTS;
export type DemoProjectKey = (typeof STANDARD_PROJECTS)[number]["key"];
export const SAMPLE_INVOICES = STANDARD_SAMPLES;

export const GST_RATE_PERCENT = 18;

function party(org: DemoOrganisation) {
  return {
    legalName: org.legalName,
    addressLines: [org.addressLine, `${org.city}, ${org.state} ${org.pincode}`],
    gstin: org.gstin,
    pan: org.pan,
    reraNumber: org.reraNumber,
    email: org.contactEmail,
    phone: org.contactPhone,
  };
}

/**
 * Booking, agreement and e-invoice particulars for a demo invoice. The seed stores exactly what
 * `buildInvoiceDocument` prints. Only the larger demo partner (Prestige) issues e-invoices.
 */
export function invoiceBrokerageContext(input: Omit<DemoInvoiceDocument, "slug" | "title">, dataset: DemoDataset = resolveDemoDataset()): DemoBrokerageContext {
  const cp = dataset.organisations[input.cp];
  if (!cp) throw new Error(`Invoice ${input.invoiceNumber} references an organisation missing from dataset "${dataset.key}"`);
  return demoBrokerageContext({
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    amountPaise: input.amountPaise,
    gstRatePercent: GST_RATE_PERCENT,
    supplierGstin: cp.gstin,
    detail: input.detail,
    eInvoice: input.cp === "prestige",
  });
}

const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export function buildInvoiceDocument(input: Omit<DemoInvoiceDocument, "slug" | "title">, dataset: DemoDataset = resolveDemoDataset()): BrokerageInvoiceData {
  const cp = dataset.organisations[input.cp];
  const builder = dataset.organisations[input.builder];
  const project = dataset.projects.find((p) => p.key === input.project);
  if (!cp || !builder || !project) throw new Error(`Invoice ${input.invoiceNumber} references an organisation or project missing from dataset "${dataset.key}"`);
  const sameState = cp.state === builder.state;
  const context = invoiceBrokerageContext(input, dataset);
  return {
    booking: { tower: context.bookingTower, unit: context.bookingUnit, buyerInitials: context.buyerInitials },
    agreement: {
      registrationNumber: context.agreementRegistrationNumber,
      date: utcDay(context.agreementDate),
      valuePaise: context.agreementValuePaise,
      brokerageBps: context.agreementBrokerageBps,
    },
    eInvoice: context.eInvoice ? { irn: context.eInvoice.irn, ackNumber: context.eInvoice.ackNumber, ackDate: utcDay(context.eInvoice.ackDate) } : null,
    tdsRateBps: context.tdsRateBps,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: new Date(`${input.invoiceDate}T00:00:00.000Z`),
    dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
    placeOfSupply: `${builder.state} (${builder.gstin?.slice(0, 2) ?? "--"})`,
    supplier: {
      ...party(cp),
      bank: cp.bankName && cp.bankAccountNumber && cp.bankIfsc ? { name: cp.bankName, account: cp.bankAccountNumber, ifsc: cp.bankIfsc } : null,
    },
    recipient: party(builder),
    project: { name: project.name, code: project.code, city: project.city, reraNumber: project.reraNumber },
    lines: [{ description: input.description, detail: input.detail, sac: "997222", amountPaise: input.amountPaise }],
    gst: { mode: sameState ? "INTRA" : "INTER", ratePercent: GST_RATE_PERCENT },
    notes: [
      "Brokerage is payable as per the channel partner empanelment agreement with the builder.",
      "Payment to be made by NEFT/RTGS to the bank account stated on this invoice.",
      "Invoice amount is inclusive of GST. Subject to Mumbai jurisdiction.",
    ],
  };
}
