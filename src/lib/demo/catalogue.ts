/**
 * Fictional demonstration organisations and documents. Shared by the database seed and the
 * sample-document download so both always describe the same data.
 */
import type { BrokerageInvoiceData } from "../pdf/brokerage-invoice";

export interface DemoOrganisation {
  key: string;
  type: "PLATFORM" | "FINANCIER" | "BUILDER" | "CHANNEL_PARTNER";
  name: string;
  legalName: string;
  gstin?: string;
  pan?: string;
  reraNumber?: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
}

export const DEMO_ORGANISATIONS = {
  platform: {
    key: "platform",
    type: "PLATFORM",
    name: "BrickFlow Platform",
    legalName: "BrickFlow Platform Operations (Demo)",
    addressLine: "4th Floor, Demo Tower, Bandra Kurla Complex",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400051",
    contactName: "Arjun Shah",
    contactEmail: "admin@brickflow.demo",
    contactPhone: "+91 22 4000 1000",
  },
  veefin: {
    key: "veefin",
    type: "FINANCIER",
    name: "Veefin Finance Demo",
    legalName: "Veefin Finance Demo Private Limited",
    gstin: "27AADCV9001D1Z5",
    pan: "AADCV9001D",
    addressLine: "12th Floor, Demo Finance Centre, Lower Parel",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400013",
    contactName: "Kavita Iyer",
    contactEmail: "finance@brickflow.demo",
    contactPhone: "+91 22 4000 2000",
    bankName: "Demo Commercial Bank",
    bankAccountNumber: "000912340000001",
    bankIfsc: "DEMO0000912",
  },
  godrej: {
    key: "godrej",
    type: "BUILDER",
    name: "Godrej Properties Demo",
    legalName: "Godrej Properties Demo Limited",
    gstin: "27AAACG9002E1Z3",
    pan: "AAACG9002E",
    reraNumber: "P51800099001",
    addressLine: "Demo Business District, Vikhroli East",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400079",
    contactName: "Rohan Mehta",
    contactEmail: "accounts@godrej-demo.test",
    contactPhone: "+91 22 4000 3000",
  },
  skyline: {
    key: "skyline",
    type: "BUILDER",
    name: "Skyline Habitat Developers",
    legalName: "Skyline Habitat Developers Demo LLP",
    gstin: "29AAKFS9003F1Z1",
    pan: "AAKFS9003F",
    reraNumber: "PRM/KA/RERA/1251/DEMO",
    addressLine: "88 Demo Residency Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560025",
    contactName: "Meera Krishnan",
    contactEmail: "accounts@skyline-demo.test",
    contactPhone: "+91 80 4000 4000",
  },
  coastal: {
    key: "coastal",
    type: "BUILDER",
    name: "Coastal Crest Builders",
    legalName: "Coastal Crest Builders Demo Private Limited",
    gstin: "30AAECC9004G1Z8",
    pan: "AAECC9004G",
    reraNumber: "PRGO0099DEMO",
    addressLine: "Demo Seafront Avenue, Panaji",
    city: "Panaji",
    state: "Goa",
    pincode: "403001",
    contactName: "Vikram Naik",
    contactEmail: "accounts@coastal-demo.test",
    contactPhone: "+91 832 400 5000",
  },
  prestige: {
    key: "prestige",
    type: "CHANNEL_PARTNER",
    name: "Prestige Realty Partners",
    legalName: "Prestige Realty Partners LLP (Demo)",
    gstin: "27AAPFP9005H1Z6",
    pan: "AAPFP9005H",
    reraNumber: "A51800099005",
    addressLine: "Office 702, Demo Corporate Park, Andheri East",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400069",
    contactName: "Ananya Rao",
    contactEmail: "partner@prestige-demo.test",
    contactPhone: "+91 98200 00005",
    bankName: "Demo Co-operative Bank",
    bankAccountNumber: "500100099005",
    bankIfsc: "DEMO0000501",
  },
  urbannest: {
    key: "urbannest",
    type: "CHANNEL_PARTNER",
    name: "UrbanNest Property Advisors",
    legalName: "UrbanNest Property Advisors Private Limited (Demo)",
    gstin: "27AACCU9006J1Z2",
    pan: "AACCU9006J",
    reraNumber: "A51700099006",
    addressLine: "2nd Floor, Demo Square, Baner",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411045",
    contactName: "Siddharth Kulkarni",
    contactEmail: "partner@urbannest-demo.test",
    contactPhone: "+91 98220 00006",
    bankName: "Demo National Bank",
    bankAccountNumber: "300200099006",
    bankIfsc: "DEMO0000302",
  },
} as const satisfies Record<string, DemoOrganisation>;

export type DemoOrgKey = keyof typeof DEMO_ORGANISATIONS;
export type DemoBuilderKey = "godrej" | "skyline" | "coastal";
export type DemoCpKey = "prestige" | "urbannest";

export const DEMO_PROJECTS = [
  { key: "gfh", builder: "godrej", code: "GFH", name: "Greenfield Heights", city: "Pune", location: "Hinjewadi Phase 2", reraNumber: "P52100099011" },
  { key: "ghz", builder: "godrej", code: "GHZ", name: "Godrej Horizon", city: "Mumbai", location: "Wadala", reraNumber: "P51800099012" },
  { key: "rgd", builder: "skyline", code: "RGD", name: "Royal Gardens", city: "Bengaluru", location: "Sarjapur Road", reraNumber: "PRM/KA/RERA/1251/DEMO/13" },
  { key: "sbv", builder: "coastal", code: "SBV", name: "Seabreeze Villas", city: "Goa", location: "Candolim", reraNumber: "PRGO0099DEMO14" },
] as const;

export type DemoProjectKey = (typeof DEMO_PROJECTS)[number]["key"];

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

export interface DemoInvoiceDocument {
  slug: string;
  title: string;
  invoiceNumber: string;
  cp: DemoCpKey;
  builder: DemoBuilderKey;
  project: DemoProjectKey;
  invoiceDate: string;
  dueDate?: string;
  amountPaise: bigint;
  description: string;
  detail: string;
}

/** The three sample invoices required for the demonstration (also seeded as live invoices). */
export const SAMPLE_INVOICES: DemoInvoiceDocument[] = [
  {
    slug: "gfh-2026-001",
    title: "Greenfield Heights — Tower B brokerage (pending approval)",
    invoiceNumber: "GFH/2026/001",
    cp: "prestige",
    builder: "godrej",
    project: "gfh",
    invoiceDate: "2026-10-20",
    dueDate: "2026-12-19",
    amountPaise: 5_00_000_00n,
    description: "Brokerage on sale of residential units — Tower B",
    detail: "Units B-1104, B-1202 and B-1503 · Agreements for sale registered Sep–Oct 2026 · Brokerage @ 2% of agreement value",
  },
  {
    slug: "gfh-2026-002",
    title: "Greenfield Heights — Tower A brokerage (accepted)",
    invoiceNumber: "GFH/2026/002",
    cp: "prestige",
    builder: "godrej",
    project: "gfh",
    invoiceDate: "2026-10-08",
    dueDate: "2026-12-07",
    amountPaise: 3_50_000_00n,
    description: "Brokerage on sale of residential units — Tower A",
    detail: "Units A-0704 and A-0902 · Agreements for sale registered Sep 2026 · Brokerage @ 2% of agreement value",
  },
  {
    slug: "gfh-2026-003",
    title: "Greenfield Heights — Retail podium brokerage (rejected)",
    invoiceNumber: "GFH/2026/003",
    cp: "prestige",
    builder: "godrej",
    project: "gfh",
    invoiceDate: "2026-10-01",
    dueDate: "2026-11-30",
    amountPaise: 2_75_000_00n,
    description: "Brokerage on sale of retail podium unit",
    detail: "Unit R-G07 · Agreement for sale registered Aug 2026 · Brokerage @ 2.5% of agreement value",
  },
];

export const GST_RATE_PERCENT = 18;

export function buildInvoiceDocument(input: Omit<DemoInvoiceDocument, "slug" | "title">): BrokerageInvoiceData {
  const cp: DemoOrganisation = DEMO_ORGANISATIONS[input.cp];
  const builder: DemoOrganisation = DEMO_ORGANISATIONS[input.builder];
  const project = DEMO_PROJECTS.find((p) => p.key === input.project)!;
  const sameState = cp.state === builder.state;
  return {
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
