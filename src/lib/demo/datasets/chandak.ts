import type { DemoDataset, DemoOrganisation } from "../types";
import { FINANCIER_ORG, PLATFORM_ORG, PLATFORM_USERS } from "./standard";

const CHANDAK = {
  key: "chandak",
  type: "BUILDER",
  name: "Chandak Group",
  legalName: "Chandak Group (Demonstration Entity)",
  gstin: "27AAHCC7314K1Z9",
  pan: "AAHCC7314K",
  addressLine: "Demo address, Andheri (East)",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400069",
  contactName: "Pooja Nair",
  contactEmail: "accounts@chandak-demo.test",
  contactPhone: "+91 22 4000 7100",
} as const satisfies DemoOrganisation;

const WESTLINE = {
  key: "westline",
  type: "CHANNEL_PARTNER",
  name: "Westline Realty Partners",
  legalName: "Westline Realty Partners LLP (Demo)",
  gstin: "27AAJFW5520P1Z2",
  pan: "AAJFW5520P",
  reraNumber: "A51800099412",
  addressLine: "Office 3, Demo Arcade, S.V. Road, Malad (West)",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400064",
  contactName: "Rahul Desai",
  contactEmail: "partner@westline-demo.test",
  contactPhone: "+91 98200 00412",
  bankName: "Demo Co-operative Bank",
  bankAccountNumber: "500100099412",
  bankIfsc: "DEMO0000501",
} as const satisfies DemoOrganisation;

const CREDIT_PERIOD_DAYS = 60;

/**
 * A deliberately small dataset for a builder pitch: one channel partner, one builder and two
 * invoices (one accepted and ready for early payment, one awaiting approval). Identifiers are
 * fictional; dates are relative so the accepted invoice is always still eligible.
 */
export const chandakDataset: DemoDataset = {
  key: "chandak",
  label: "Chandak Group pitch",
  organisations: { platform: PLATFORM_ORG, veefin: FINANCIER_ORG, chandak: CHANDAK, westline: WESTLINE },
  financier: "veefin",
  users: [
    ...PLATFORM_USERS,
    { key: "chandak", email: CHANDAK.contactEmail, name: CHANDAK.contactName, org: "chandak", role: "BUILDER_ACCOUNTS", designation: "Accounts Payable Lead", loginCard: true },
    { key: "westline", email: WESTLINE.contactEmail, name: WESTLINE.contactName, org: "westline", role: "CP_ADMIN", designation: "Managing Partner", loginCard: true },
  ],
  projects: [
    { key: "cts", builder: "chandak", code: "CTS", name: "Chandak Treesourus", city: "Mumbai", location: "Malad (West)", reraNumber: "P51800DEMO031" },
    { key: "pke", builder: "chandak", code: "PKE", name: "34 Park Estate", city: "Mumbai", location: "Goregaon (West)", reraNumber: "P51800DEMO032" },
  ],
  empanelments: [{ cp: "westline", builder: "chandak", code: "CG-CP-0412", creditPeriodDays: CREDIT_PERIOD_DAYS }],
  programmes: [
    {
      code: "BF-PRG-0001",
      builder: "chandak",
      name: "Chandak Group — Channel Partner Early Payment",
      bps: 300,
      terms:
        "Fixed discount of 3% on the builder-approved invoice amount, agreed between Veefin and Chandak Group. No processing fees or other charges. " +
        "Chandak Group settles the full approved amount with Veefin on the original invoice due date; the channel partner's credit terms are unchanged.",
    },
  ],
  samples: ({ isoDate }) => [
    {
      slug: "wrp-2026-016",
      title: "Chandak Treesourus — new brokerage invoice to upload",
      invoiceNumber: "WRP/2026/016",
      cp: "westline",
      builder: "chandak",
      project: "cts",
      invoiceDate: isoDate(-1),
      dueDate: isoDate(CREDIT_PERIOD_DAYS - 1),
      amountPaise: 2_00_000_00n,
      description: "Brokerage on sale of residential unit — Chandak Treesourus",
      detail: "Flat 1802, Tower B · Agreement for sale registered this month · Brokerage as per empanelment schedule",
    },
    {
      slug: "wrp-2026-017",
      title: "34 Park Estate — new brokerage invoice to upload",
      invoiceNumber: "WRP/2026/017",
      cp: "westline",
      builder: "chandak",
      project: "pke",
      invoiceDate: isoDate(-1),
      dueDate: isoDate(CREDIT_PERIOD_DAYS - 1),
      amountPaise: 4_00_000_00n,
      description: "Brokerage on sale of residential unit — 34 Park Estate",
      detail: "Flat 2104, Wing A · Agreement for sale registered this month · Brokerage as per empanelment schedule",
    },
  ],
  invoices: ({ daysAgo, isoDate }) => [
    {
      invoiceNumber: "WRP/2026/014",
      cp: "westline",
      builder: "chandak",
      project: "cts",
      invoiceDate: isoDate(-12),
      dueDate: isoDate(CREDIT_PERIOD_DAYS - 12),
      amountPaise: 5_00_000_00n,
      description: "Brokerage on sale of residential unit — Chandak Treesourus",
      detail: "Flat 1204, Tower A · Agreement for sale registered last month · Brokerage as per empanelment schedule",
      submittedAt: daysAgo(10, 11),
      status: "ACCEPTED",
      review: { underReviewAt: daysAgo(9, 10), at: daysAgo(8, 16), note: "Verified against the booking register and the registered agreement." },
    },
    {
      invoiceNumber: "WRP/2026/015",
      cp: "westline",
      builder: "chandak",
      project: "pke",
      invoiceDate: isoDate(-3),
      dueDate: isoDate(CREDIT_PERIOD_DAYS - 3),
      amountPaise: 3_00_000_00n,
      description: "Brokerage on sale of residential unit — 34 Park Estate",
      detail: "Flat 0903, Wing B · Agreement for sale registered this month · Brokerage as per empanelment schedule",
      submittedAt: daysAgo(2, 15),
      status: "SUBMITTED",
    },
  ],
};
