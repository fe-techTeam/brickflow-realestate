/**
 * Seeds a complete, internally consistent demonstration dataset: organisations, users, projects,
 * empanelments, financing programmes and invoices at every stage of the workflow, with matching
 * approval history, offers, financing events, disbursements, settlements, audit logs and PDFs.
 *
 * Idempotent: wipes demo tables and stored invoice files, then recreates everything.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, type FinancingStatus, type InvoiceStatus } from "../src/generated/prisma/client";
import { calculateDiscount } from "../src/lib/financing";
import { buildInvoiceDocument, DEMO_ORGANISATIONS, DEMO_PROJECTS, GST_RATE_PERCENT, SAMPLE_INVOICES, type DemoBuilderKey, type DemoCpKey, type DemoOrgKey, type DemoProjectKey } from "../src/lib/demo/catalogue";
import { renderBrokerageInvoicePdf, splitGstInclusive } from "../src/lib/pdf/brokerage-invoice";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured");
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "./storage");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "BrickFlow@2026";
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();

const at = (iso: string, time = "10:30") => new Date(`${iso}T${time}:00.000+05:30`);
const daysAgo = (days: number, hour = 11) => new Date(NOW.getTime() - days * DAY + (hour - 12) * 60 * 60 * 1000);
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function reset() {
  await db.$transaction([
    db.auditLog.deleteMany(),
    db.internalComment.deleteMany(),
    db.financingEvent.deleteMany(),
    db.settlement.deleteMany(),
    db.disbursement.deleteMany(),
    db.financingRequest.deleteMany(),
    db.financingOffer.deleteMany(),
    db.invoiceApproval.deleteMany(),
    db.invoiceDocument.deleteMany(),
    db.invoice.deleteMany(),
    db.financingProgramme.deleteMany(),
    db.cpBuilderRelationship.deleteMany(),
    db.project.deleteMany(),
    db.organisationUser.deleteMany(),
    db.user.deleteMany(),
    db.role.deleteMany(),
    db.organisation.deleteMany(),
    db.sequence.deleteMany(),
    db.platformSetting.deleteMany(),
  ]);
  await rm(path.join(STORAGE_ROOT, "invoices"), { recursive: true, force: true });
}

const counters = new Map<string, number>();
function reference(prefix: string, year = 2026, width = 6) {
  const key = `${prefix}:${year}`;
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return `${prefix}-${year}-${String(next).padStart(width, "0")}`;
}

async function persistSequences() {
  const kinds: Record<string, string> = { "BF-INV": "invoice", "BF-OFR": "offer", "BF-FIN": "request", "BFPAY-DEMO": "payment" };
  for (const [key, value] of counters) {
    const [prefix, year] = key.split(":");
    await db.sequence.create({ data: { name: `${kinds[prefix!]}:${year}`, value } });
  }
}

type Actor = { userId: string; name: string; orgId: string; role: string };

async function audit(actor: Actor | null, action: string, entityType: string, entityId: string, summary: string, createdAt: Date, metadata?: object) {
  await db.auditLog.create({
    data: {
      actorUserId: actor?.userId ?? null,
      actorName: actor?.name ?? "System",
      actorOrgId: actor?.orgId ?? null,
      actorRole: actor?.role ?? null,
      action,
      entityType,
      entityId,
      summary,
      metadata: metadata ? JSON.stringify(metadata, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : null,
      createdAt,
    },
  });
}

async function main() {
  await reset();

  const roles = Object.fromEntries(
    await Promise.all(
      (
        [
          ["SUPER_ADMIN", "Super Administrator", "Configures organisations, financing programmes and platform settings."],
          ["FINANCE_OPS", "Finance Operations", "Reviews financing requests, disburses and records settlements for the financier."],
          ["BUILDER_ACCOUNTS", "Builder Accounts", "Reviews and approves channel partner invoices for the builder."],
          ["CP_ADMIN", "Channel Partner Administrator", "Submits invoices and requests early payment for the channel partner."],
        ] as const
      ).map(async ([key, name, description]) => [key, await db.role.create({ data: { key, name, description } })] as const),
    ),
  );

  const orgs = {} as Record<DemoOrgKey, { id: string; name: string }>;
  for (const org of Object.values(DEMO_ORGANISATIONS)) {
    const created = await db.organisation.create({
      data: {
        type: org.type,
        name: org.name,
        legalName: org.legalName,
        gstin: "gstin" in org ? org.gstin : null,
        pan: "pan" in org ? org.pan : null,
        reraNumber: "reraNumber" in org ? org.reraNumber : null,
        addressLine: org.addressLine,
        city: org.city,
        state: org.state,
        pincode: org.pincode,
        contactName: org.contactName,
        contactEmail: org.contactEmail,
        contactPhone: org.contactPhone,
        bankName: "bankName" in org ? org.bankName : null,
        bankAccountNumber: "bankAccountNumber" in org ? org.bankAccountNumber : null,
        bankIfsc: "bankIfsc" in org ? org.bankIfsc : null,
        createdAt: at("2026-03-15"),
      },
    });
    orgs[org.key] = { id: created.id, name: created.name };
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const userDefs = [
    { key: "admin", email: "admin@brickflow.demo", name: "Arjun Shah", org: "platform", role: "SUPER_ADMIN", designation: "Platform Administrator" },
    { key: "finance", email: "finance@brickflow.demo", name: "Kavita Iyer", org: "veefin", role: "FINANCE_OPS", designation: "Head of Credit Operations" },
    { key: "finance2", email: "credit.analyst@brickflow.demo", name: "Nikhil Bansal", org: "veefin", role: "FINANCE_OPS", designation: "Credit Analyst" },
    { key: "godrej", email: "accounts@godrej-demo.test", name: "Rohan Mehta", org: "godrej", role: "BUILDER_ACCOUNTS", designation: "Accounts Payable Manager" },
    { key: "skyline", email: "accounts@skyline-demo.test", name: "Meera Krishnan", org: "skyline", role: "BUILDER_ACCOUNTS", designation: "Finance Controller" },
    { key: "coastal", email: "accounts@coastal-demo.test", name: "Vikram Naik", org: "coastal", role: "BUILDER_ACCOUNTS", designation: "Accounts Lead" },
    { key: "prestige", email: "partner@prestige-demo.test", name: "Ananya Rao", org: "prestige", role: "CP_ADMIN", designation: "Managing Partner" },
    { key: "urbannest", email: "partner@urbannest-demo.test", name: "Siddharth Kulkarni", org: "urbannest", role: "CP_ADMIN", designation: "Director" },
  ] as const;

  const users = {} as Record<(typeof userDefs)[number]["key"], Actor>;
  for (const def of userDefs) {
    const user = await db.user.create({
      data: {
        email: def.email,
        name: def.name,
        passwordHash,
        createdAt: at("2026-03-20"),
        memberships: { create: { organisationId: orgs[def.org].id, roleId: roles[def.role]!.id, designation: def.designation } },
      },
    });
    users[def.key] = { userId: user.id, name: user.name, orgId: orgs[def.org].id, role: def.role };
  }

  const projects = {} as Record<DemoProjectKey, { id: string; name: string }>;
  for (const p of DEMO_PROJECTS) {
    const created = await db.project.create({
      data: { builderId: orgs[p.builder].id, code: p.code, name: p.name, city: p.city, location: p.location, reraNumber: p.reraNumber, createdAt: at("2026-03-25") },
    });
    projects[p.key] = { id: created.id, name: created.name };
  }

  const empanelments: [DemoOrgKey, DemoOrgKey, string, number][] = [
    ["prestige", "godrej", "GPL-CP-0417", 60],
    ["prestige", "skyline", "SHD-CP-0088", 45],
    ["urbannest", "godrej", "GPL-CP-0522", 60],
    ["urbannest", "skyline", "SHD-CP-0102", 45],
    ["urbannest", "coastal", "CCB-CP-0019", 30],
  ];
  for (const [cp, builder, code, credit] of empanelments) {
    await db.cpBuilderRelationship.create({
      data: { cpId: orgs[cp].id, builderId: orgs[builder].id, empanelmentCode: code, creditPeriodDays: credit, empanelledAt: at("2026-04-01") },
    });
  }

  const programmeDefs = [
    {
      code: "BF-PRG-0001",
      builder: "godrej",
      name: "Godrej Properties Demo — Channel Partner Early Payment",
      bps: 300,
      terms:
        "Fixed discount of 3% on the builder-approved invoice amount, agreed between Veefin and the builder. No processing fees or other charges. " +
        "The builder settles the full approved amount with Veefin on the original invoice due date; the channel partner's credit terms with the builder are unchanged.",
    },
    {
      code: "BF-PRG-0002",
      builder: "skyline",
      name: "Skyline Habitat — Partner Liquidity Programme",
      bps: 250,
      terms:
        "Fixed discount of 2.5% on the builder-approved invoice amount. No additional charges. Settlement by the builder to Veefin on the original due date of each invoice.",
    },
    {
      code: "BF-PRG-0003",
      builder: "coastal",
      name: "Coastal Crest — Brokerage Advance Facility",
      bps: 350,
      terms: "Fixed discount of 3.5% on the builder-approved invoice amount. No additional charges. Builder settles on the original due date.",
    },
  ] as const;
  const programmes = {} as Record<string, { id: string; bps: number; code: string; name: string; terms: string }>;
  for (const def of programmeDefs) {
    const created = await db.financingProgramme.create({
      data: {
        code: def.code,
        name: def.name,
        builderId: orgs[def.builder].id,
        financierId: orgs.veefin.id,
        discountRateBps: def.bps,
        status: "ACTIVE",
        effectiveFrom: dateOnly("2026-04-01"),
        offerValidityDays: 7,
        terms: def.terms,
        createdById: users.admin.userId,
        createdAt: at("2026-03-28"),
      },
    });
    programmes[def.builder] = { id: created.id, bps: def.bps, code: def.code, name: def.name, terms: def.terms };
    await audit(users.admin, "programme.created", "FinancingProgramme", created.id, `Created programme ${def.code} for ${orgs[def.builder].name} at ${def.bps / 100}% (active)`, at("2026-03-28"), {
      discountRateBps: def.bps,
    });
  }
  await db.sequence.create({ data: { name: "programme", value: programmeDefs.length } });

  interface SeedInvoice {
    invoiceNumber: string;
    cp: DemoCpKey;
    builder: DemoBuilderKey;
    project: DemoProjectKey;
    invoiceDate: string;
    dueDate?: string;
    amountPaise: bigint;
    description: string;
    detail: string;
    submittedAt: Date;
    status: InvoiceStatus;
    review?: { at: Date; note?: string; approvedAmountPaise?: bigint; underReviewAt?: Date };
    financing?: { stage: FinancingStatus; offerAt: Date; acceptedAt: Date; decidedAt?: Date; disbursedAt?: Date; completedAt?: Date; settledAt?: Date; rejectReason?: string };
  }

  const sample = (slug: string) => SAMPLE_INVOICES.find((s) => s.slug === slug)!;
  const invoices: SeedInvoice[] = [
    { ...sample("gfh-2026-001"), submittedAt: daysAgo(1, 15), status: "SUBMITTED" },
    {
      ...sample("gfh-2026-002"),
      submittedAt: daysAgo(12, 11),
      status: "ACCEPTED",
      review: { underReviewAt: daysAgo(11, 10), at: daysAgo(9, 16), note: "Verified against booking register and registered agreements." },
    },
    {
      ...sample("gfh-2026-003"),
      submittedAt: daysAgo(20, 12),
      status: "REJECTED",
      review: { underReviewAt: daysAgo(19, 10), at: daysAgo(18, 17), note: "Supporting brokerage calculation requires clarification." },
    },
    {
      invoiceNumber: "GHZ/2026/014",
      cp: "prestige",
      builder: "godrej",
      project: "ghz",
      invoiceDate: "2026-09-12",
      dueDate: "2026-11-30",
      amountPaise: 8_40_000_00n,
      description: "Brokerage on sale of premium residences — Godrej Horizon",
      detail: "Units 2401 and 2702 (Wing C) · Brokerage @ 2% of agreement value",
      submittedAt: daysAgo(48, 11),
      status: "ACCEPTED",
      review: { underReviewAt: daysAgo(47, 10), at: daysAgo(45, 15), note: "Approved." },
      financing: { stage: "DISBURSED", offerAt: daysAgo(44, 10), acceptedAt: daysAgo(44, 11), decidedAt: daysAgo(43, 12), disbursedAt: daysAgo(43, 15), completedAt: daysAgo(43, 16) },
    },
    {
      invoiceNumber: "RGD/2026/007",
      cp: "prestige",
      builder: "skyline",
      project: "rgd",
      invoiceDate: "2026-10-05",
      dueDate: "2026-11-19",
      amountPaise: 4_20_000_00n,
      description: "Brokerage on villa plot sales — Royal Gardens",
      detail: "Plots RG-118 and RG-121 · Brokerage @ 2% of sale consideration",
      submittedAt: daysAgo(16, 12),
      status: "ACCEPTED",
      review: { at: daysAgo(10, 14), approvedAmountPaise: 4_00_000_00n, note: "Approved at ₹4,00,000 — plot RG-121 brokerage capped as per empanelment schedule." },
      financing: { stage: "PENDING_APPROVAL", offerAt: daysAgo(2, 10), acceptedAt: daysAgo(2, 11) },
    },
    {
      invoiceNumber: "UNA/GFH/2026/031",
      cp: "urbannest",
      builder: "godrej",
      project: "gfh",
      invoiceDate: "2026-10-14",
      dueDate: "2026-12-13",
      amountPaise: 6_15_000_00n,
      description: "Brokerage on sale of residential units — Tower C",
      detail: "Units C-0405, C-0811 and C-1209 · Brokerage @ 2% of agreement value",
      submittedAt: daysAgo(5, 11),
      status: "UNDER_REVIEW",
      review: { underReviewAt: daysAgo(4, 12), at: daysAgo(4, 12) },
    },
    {
      invoiceNumber: "UNA/GHZ/2026/009",
      cp: "urbannest",
      builder: "godrej",
      project: "ghz",
      invoiceDate: "2026-09-28",
      dueDate: "2026-11-27",
      amountPaise: 2_95_000_00n,
      description: "Brokerage on sale of residence — Godrej Horizon",
      detail: "Unit 1806 (Wing A) · Brokerage @ 2% of agreement value",
      submittedAt: daysAgo(30, 10),
      status: "ACCEPTED",
      review: { at: daysAgo(26, 15), note: "Approved." },
      financing: { stage: "APPROVED", offerAt: daysAgo(6, 10), acceptedAt: daysAgo(6, 11), decidedAt: daysAgo(3, 15) },
    },
    {
      invoiceNumber: "UNA/RGD/2026/004",
      cp: "urbannest",
      builder: "skyline",
      project: "rgd",
      invoiceDate: "2026-07-18",
      dueDate: "2026-09-01",
      amountPaise: 3_80_000_00n,
      description: "Brokerage on villa plot sale — Royal Gardens",
      detail: "Plot RG-044 · Brokerage @ 2% of sale consideration",
      submittedAt: daysAgo(105, 11),
      status: "ACCEPTED",
      review: { at: daysAgo(101, 12), note: "Approved." },
      financing: {
        stage: "DISBURSED",
        offerAt: daysAgo(100, 10),
        acceptedAt: daysAgo(100, 11),
        decidedAt: daysAgo(99, 12),
        disbursedAt: daysAgo(99, 15),
        completedAt: daysAgo(99, 16),
        settledAt: daysAgo(62, 12),
      },
    },
    {
      invoiceNumber: "UNA/SBV/2026/002",
      cp: "urbannest",
      builder: "coastal",
      project: "sbv",
      invoiceDate: "2026-10-22",
      amountPaise: 1_85_000_00n,
      description: "Brokerage on villa sale — Seabreeze Villas",
      detail: "Villa SB-12 · Brokerage @ 2% of agreement value",
      submittedAt: daysAgo(6, 14),
      status: "CLARIFICATION_REQUESTED",
      review: { at: daysAgo(3, 11), note: "Please attach the registered agreement copy and confirm the brokerage slab applied for villa SB-12." },
    },
  ];

  for (const inv of invoices) {
    const doc = buildInvoiceDocument(inv);
    const pdf = await renderBrokerageInvoicePdf(doc);
    const storageKey = `invoices/seed/${randomUUID()}.pdf`;
    await mkdir(path.join(STORAGE_ROOT, "invoices", "seed"), { recursive: true });
    await writeFile(path.join(STORAGE_ROOT, storageKey), pdf);

    const gst = splitGstInclusive(inv.amountPaise, GST_RATE_PERCENT, doc.gst!.mode);
    const cpUser = users[inv.cp];
    const builderUser = users[inv.builder];
    const invoiceRef = reference("BF-INV");
    const approved = inv.status === "ACCEPTED" ? (inv.review?.approvedAmountPaise ?? inv.amountPaise) : null;

    const created = await db.invoice.create({
      data: {
        reference: invoiceRef,
        invoiceNumber: inv.invoiceNumber,
        cpId: orgs[inv.cp].id,
        builderId: orgs[inv.builder].id,
        projectId: projects[inv.project].id,
        invoiceDate: dateOnly(inv.invoiceDate),
        dueDate: inv.dueDate ? dateOnly(inv.dueDate) : null,
        amountPaise: inv.amountPaise,
        gstAmountPaise: gst.cgstPaise + gst.sgstPaise + gst.igstPaise,
        approvedAmountPaise: approved,
        description: `${inv.description}. ${inv.detail}`,
        status: inv.status,
        financingStatus: inv.financing?.stage ?? "NOT_REQUESTED",
        latestReviewNote: inv.review?.note ?? null,
        submittedAt: inv.submittedAt,
        decidedAt: inv.status === "ACCEPTED" || inv.status === "REJECTED" ? inv.review!.at : null,
        createdById: cpUser.userId,
        createdAt: inv.submittedAt,
        documents: {
          create: {
            fileName: `${inv.invoiceNumber.replace(/\//g, "-")}.pdf`,
            storageKey,
            mimeType: "application/pdf",
            sizeBytes: pdf.byteLength,
            sha256: createHash("sha256").update(pdf).digest("hex"),
            uploadedById: cpUser.userId,
            createdAt: inv.submittedAt,
          },
        },
      },
    });

    const approval = (action: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLARIFICATION_REQUESTED", from: InvoiceStatus | null, to: InvoiceStatus, by: Actor, createdAt: Date, comment?: string) =>
      db.invoiceApproval.create({
        data: { invoiceId: created.id, action, fromStatus: from, toStatus: to, comment: comment ?? null, actorUserId: by.userId, actorName: by.name, actorOrgId: by.orgId, createdAt },
      });

    await approval("SUBMITTED", null, "SUBMITTED", cpUser, inv.submittedAt);
    await audit(cpUser, "invoice.submitted", "Invoice", created.id, `Submitted invoice ${inv.invoiceNumber} (${invoiceRef}) to ${orgs[inv.builder].name}`, inv.submittedAt, {
      amountPaise: inv.amountPaise,
    });

    let current: InvoiceStatus = "SUBMITTED";
    if (inv.review?.underReviewAt) {
      await approval("UNDER_REVIEW", current, "UNDER_REVIEW", builderUser, inv.review.underReviewAt);
      await audit(builderUser, "invoice.under_review", "Invoice", created.id, `Started review of invoice ${inv.invoiceNumber}`, inv.review.underReviewAt);
      current = "UNDER_REVIEW";
    }
    if (inv.status === "ACCEPTED") {
      await approval("APPROVED", current, "ACCEPTED", builderUser, inv.review!.at, inv.review!.note);
      await audit(builderUser, "invoice.approved", "Invoice", created.id, `Approved invoice ${inv.invoiceNumber}`, inv.review!.at, { approvedAmountPaise: approved });
    } else if (inv.status === "REJECTED") {
      await approval("REJECTED", current, "REJECTED", builderUser, inv.review!.at, inv.review!.note);
      await audit(builderUser, "invoice.rejected", "Invoice", created.id, `Rejected invoice ${inv.invoiceNumber}`, inv.review!.at, { reason: inv.review!.note });
    } else if (inv.status === "CLARIFICATION_REQUESTED") {
      await approval("CLARIFICATION_REQUESTED", current, "CLARIFICATION_REQUESTED", builderUser, inv.review!.at, inv.review!.note);
      await audit(builderUser, "invoice.clarification_requested", "Invoice", created.id, `Requested clarification on invoice ${inv.invoiceNumber}`, inv.review!.at);
    }

    if (!inv.financing || !approved) continue;
    const f = inv.financing;
    const programme = programmes[inv.builder]!;
    const calc = calculateDiscount(approved, programme.bps);
    const offerRef = reference("BF-OFR");
    const consent =
      "I confirm that I wish to receive early payment for this builder-approved invoice at the discount shown. I understand the discount is deducted upfront, that the net amount will be paid to my registered bank account, and that the builder will settle the full approved amount with the financier on the original due date. This is a demonstration transaction and no real funds will move.";
    const offer = await db.financingOffer.create({
      data: {
        reference: offerRef,
        invoiceId: created.id,
        programmeId: programme.id,
        invoiceAmountPaise: inv.amountPaise,
        approvedAmountPaise: calc.approvedAmountPaise,
        discountRateBps: calc.discountRateBps,
        discountAmountPaise: calc.discountAmountPaise,
        chargesPaise: 0n,
        netPayablePaise: calc.netPayablePaise,
        termsSnapshot: JSON.stringify({
          programmeCode: programme.code,
          programmeName: programme.name,
          financier: orgs.veefin.name,
          discountRateBps: programme.bps,
          offerValidityDays: 7,
          terms: programme.terms,
        }),
        status: "ACCEPTED",
        generatedById: cpUser.userId,
        generatedAt: f.offerAt,
        validUntil: new Date(f.offerAt.getTime() + 7 * DAY),
        acceptedById: cpUser.userId,
        acceptedAt: f.acceptedAt,
        consentText: consent,
      },
    });
    await audit(cpUser, "financing.offer_generated", "FinancingOffer", offer.id, `Generated offer ${offerRef} on invoice ${inv.invoiceNumber}`, f.offerAt, calc);

    const requestRef = reference("BF-FIN");
    const request = await db.financingRequest.create({
      data: {
        reference: requestRef,
        invoiceId: created.id,
        offerId: offer.id,
        programmeId: programme.id,
        cpId: orgs[inv.cp].id,
        builderId: orgs[inv.builder].id,
        financierId: orgs.veefin.id,
        approvedAmountPaise: calc.approvedAmountPaise,
        discountRateBps: calc.discountRateBps,
        discountAmountPaise: calc.discountAmountPaise,
        chargesPaise: 0n,
        netPayablePaise: calc.netPayablePaise,
        status: f.stage,
        acceptedById: cpUser.userId,
        acceptedAt: f.acceptedAt,
        decidedById: f.decidedAt ? users.finance.userId : null,
        decidedAt: f.decidedAt ?? null,
        decisionNote: f.decidedAt ? "Within programme limits; KYC on file." : null,
        createdAt: f.acceptedAt,
      },
    });
    const event = (from: FinancingStatus | null, to: FinancingStatus, by: Actor | null, createdAt: Date, note: string) =>
      db.financingEvent.create({ data: { requestId: request.id, fromStatus: from, toStatus: to, actorUserId: by?.userId ?? null, actorName: by?.name ?? "System", note, createdAt } });

    await event(null, "ACCEPTED_BY_CP", cpUser, f.acceptedAt, `Offer ${offerRef} accepted with explicit consent`);
    await event("ACCEPTED_BY_CP", "PENDING_APPROVAL", null, f.acceptedAt, "Submitted to Veefin for approval");
    await audit(cpUser, "financing.offer_accepted", "FinancingRequest", request.id, `Accepted offer ${offerRef}; financing request ${requestRef} created`, f.acceptedAt, calc);

    if (f.decidedAt) {
      await event("PENDING_APPROVAL", "APPROVED", users.finance, f.decidedAt, "Within programme limits; KYC on file.");
      await audit(users.finance, "financing.approved", "FinancingRequest", request.id, `Approved financing request ${requestRef}`, f.decidedAt);
    }
    if (f.disbursedAt) {
      const paymentRef = reference("BFPAY-DEMO");
      const cpOrg = DEMO_ORGANISATIONS[inv.cp];
      const account = "bankAccountNumber" in cpOrg ? cpOrg.bankAccountNumber : "0000";
      const completed = Boolean(f.completedAt);
      await db.disbursement.create({
        data: {
          requestId: request.id,
          reference: paymentRef,
          amountPaise: calc.netPayablePaise,
          status: completed ? "SUCCESS" : "INITIATED",
          beneficiaryName: cpOrg.legalName,
          beneficiaryAccount: `XXXX${account.slice(-4)}`,
          beneficiaryIfsc: "bankIfsc" in cpOrg ? cpOrg.bankIfsc : "DEMO0000001",
          utr: completed ? `DEMOUTR2026${String(100000000 + counters.get("BFPAY-DEMO:2026")! * 7919).slice(0, 9)}` : null,
          initiatedById: users.finance.userId,
          initiatedAt: f.disbursedAt,
          completedById: completed ? users.finance.userId : null,
          completedAt: f.completedAt ?? null,
        },
      });
      await event("APPROVED", "DISBURSEMENT_INITIATED", users.finance, f.disbursedAt, `Simulated payout ${paymentRef} initiated`);
      await audit(users.finance, "disbursement.initiated", "Disbursement", request.id, `Initiated simulated disbursement ${paymentRef}`, f.disbursedAt, { simulated: true });
      if (completed) {
        await event("DISBURSEMENT_INITIATED", "DISBURSED", users.finance, f.completedAt!, "Simulated transfer confirmed");
        await audit(users.finance, "disbursement.completed", "Disbursement", request.id, `Simulated disbursement for ${requestRef} completed`, f.completedAt!, { simulated: true });
        const due = inv.dueDate ? dateOnly(inv.dueDate) : new Date(dateOnly(inv.invoiceDate).getTime() + 60 * DAY);
        const settlement = await db.settlement.create({
          data: {
            requestId: request.id,
            builderId: orgs[inv.builder].id,
            financierId: orgs.veefin.id,
            amountPaise: calc.approvedAmountPaise,
            dueDate: due,
            status: f.settledAt ? "SETTLED" : due.getTime() > NOW.getTime() ? "NOT_DUE" : "OVERDUE",
            reference: f.settledAt ? "NEFT-DEMO-SKY-0901" : null,
            settledAt: f.settledAt ?? null,
            settledById: f.settledAt ? users.finance.userId : null,
            note: f.settledAt ? "Received from builder on due date." : null,
            createdAt: f.completedAt!,
          },
        });
        if (f.settledAt) {
          await audit(users.finance, "settlement.settled", "Settlement", settlement.id, `Marked settlement for ${requestRef} as settled`, f.settledAt);
        }
      }
    }
  }

  await db.internalComment.createMany({
    data: [
      {
        requestId: (await db.financingRequest.findFirstOrThrow({ where: { invoice: { invoiceNumber: "RGD/2026/007" } } })).id,
        body: "Builder approved a reduced amount (₹4,00,000). Offer computed on the approved amount — consistent with programme terms.",
        authorId: users.finance2.userId,
        authorName: users.finance2.name,
        createdAt: daysAgo(1, 12),
      },
    ],
  });

  await persistSequences();
  await db.platformSetting.createMany({
    data: [
      { key: "platform.supportEmail", value: "support@brickflow.demo", updatedById: users.admin.userId },
      { key: "platform.defaultCreditPeriodDays", value: "60", updatedById: users.admin.userId },
      { key: "platform.demoBanner", value: "Demo environment — all disbursements are simulated and no real funds move.", updatedById: users.admin.userId },
    ],
  });

  const summary = await Promise.all([db.organisation.count(), db.user.count(), db.invoice.count(), db.financingRequest.count()]);
  console.log(`Seeded ${summary[0]} organisations, ${summary[1]} users, ${summary[2]} invoices, ${summary[3]} financing requests.`);
  if (process.env.NODE_ENV !== "production") console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
