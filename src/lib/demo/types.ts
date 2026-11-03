import type { FinancingStatus, InvoiceStatus, RoleKey } from "../../generated/prisma/enums";

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

export interface DemoUser {
  key: string;
  email: string;
  name: string;
  org: string;
  role: RoleKey;
  designation: string;
  /** Offered as a one-click workspace card on the sign-in page. */
  loginCard?: boolean;
}

export interface DemoProject {
  key: string;
  builder: string;
  code: string;
  name: string;
  city: string;
  location: string;
  reraNumber: string;
}

export interface DemoEmpanelment {
  cp: string;
  builder: string;
  code: string;
  creditPeriodDays: number;
}

export interface DemoProgramme {
  code: string;
  builder: string;
  name: string;
  bps: number;
  terms: string;
}

export interface DemoInvoiceDocument {
  slug: string;
  title: string;
  invoiceNumber: string;
  cp: string;
  builder: string;
  project: string;
  invoiceDate: string;
  dueDate?: string;
  amountPaise: bigint;
  description: string;
  detail: string;
}

export interface DemoSeedInvoice extends Omit<DemoInvoiceDocument, "slug" | "title"> {
  submittedAt: Date;
  status: InvoiceStatus;
  review?: { at: Date; note?: string; approvedAmountPaise?: bigint; underReviewAt?: Date };
  financing?: {
    stage: FinancingStatus;
    offerAt: Date;
    acceptedAt: Date;
    decidedAt?: Date;
    disbursedAt?: Date;
    completedAt?: Date;
    settledAt?: Date;
  };
}

export interface DemoInternalComment {
  invoiceNumber: string;
  author: string;
  body: string;
  createdAt: Date;
}

/** Relative-date helpers so seeded data stays current whenever the dataset is loaded. */
export interface DemoClock {
  now: Date;
  /** A timestamp `days` before now at the given local hour. */
  daysAgo(days: number, hour?: number): Date;
  /** An ISO calendar date (YYYY-MM-DD) offset from today; negative is in the past. */
  isoDate(offsetDays: number): string;
}

export interface DemoDataset {
  key: string;
  label: string;
  organisations: Record<string, DemoOrganisation>;
  /** Organisation key of the financier that funds every programme. */
  financier: string;
  users: DemoUser[];
  projects: DemoProject[];
  empanelments: DemoEmpanelment[];
  programmes: DemoProgramme[];
  /** Downloadable sample invoices offered to channel partners for the upload flow. */
  samples(clock: DemoClock): DemoInvoiceDocument[];
  invoices(clock: DemoClock): DemoSeedInvoice[];
  internalComments?(clock: DemoClock): DemoInternalComment[];
}
