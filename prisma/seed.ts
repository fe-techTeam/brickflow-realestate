/**
 * Seeds an internally consistent demonstration dataset (selected by DEMO_DATASET, default
 * "standard"): organisations, users, projects, empanelments, financing programmes and invoices,
 * with matching approval history, offers, financing events, disbursements, settlements, audit
 * logs and PDFs.
 *
 * Idempotent: wipes demo tables and stored invoice files, then recreates everything.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type FinancingStatus, type InvoiceStatus } from "../src/generated/prisma/client";
import { appendAuditEntry } from "../src/lib/audit-chain";
import { calculateDiscount } from "../src/lib/financing";
import { buildInvoiceDocument, demoClock, GST_RATE_PERCENT, resolveDemoDataset } from "../src/lib/demo/catalogue";
import { renderBrokerageInvoicePdf, splitGstInclusive } from "../src/lib/pdf/brokerage-invoice";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "./storage");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "BrickFlow@2026";
const DAY = 24 * 60 * 60 * 1000;
const DATASET = resolveDemoDataset();
const CLOCK = demoClock();
const NOW = CLOCK.now;

const at = (iso: string, time = "10:30") => new Date(`${iso}T${time}:00.000+05:30`);
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function reset() {
  await db.$transaction([
    db.auditLog.deleteMany(),
    db.auditAnchor.deleteMany(),
    db.auditChainCheck.deleteMany(),
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
  // The audit log was emptied, so there are no pre-chain rows left to seal.
  const sealed = { legacyCutoffSeq: 0n, legacySealedAt: new Date() };
  await db.auditChainState.upsert({ where: { id: 1 }, create: { id: 1, ...sealed }, update: sealed });
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
  await db.$transaction((tx) =>
    appendAuditEntry(tx, {
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
    }),
  );
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

  const orgs: Record<string, { id: string; name: string }> = {};
  for (const org of Object.values(DATASET.organisations)) {
    const created = await db.organisation.create({
      data: {
        type: org.type,
        name: org.name,
        legalName: org.legalName,
        gstin: org.gstin ?? null,
        pan: org.pan ?? null,
        reraNumber: org.reraNumber ?? null,
        addressLine: org.addressLine,
        city: org.city,
        state: org.state,
        pincode: org.pincode,
        contactName: org.contactName,
        contactEmail: org.contactEmail,
        contactPhone: org.contactPhone,
        bankName: org.bankName ?? null,
        bankAccountNumber: org.bankAccountNumber ?? null,
        bankIfsc: org.bankIfsc ?? null,
        createdAt: at("2026-03-15"),
      },
    });
    orgs[org.key] = { id: created.id, name: created.name };
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const users: Record<string, Actor> = {};
  for (const def of DATASET.users) {
    const user = await db.user.create({
      data: {
        email: def.email,
        name: def.name,
        passwordHash,
        createdAt: at("2026-03-20"),
        memberships: { create: { organisationId: orgs[def.org]!.id, roleId: roles[def.role]!.id, designation: def.designation } },
      },
    });
    users[def.key] = { userId: user.id, name: user.name, orgId: orgs[def.org]!.id, role: def.role };
  }
  const userFor = (orgKey: string, role: string) => {
    const def = DATASET.users.find((u) => u.org === orgKey && u.role === role);
    if (!def) throw new Error(`Dataset "${DATASET.key}" has no ${role} user for ${orgKey}`);
    return users[def.key]!;
  };
  const admin = userFor("platform", "SUPER_ADMIN");
  const financeOps = userFor(DATASET.financier, "FINANCE_OPS");
  const financierOrg = orgs[DATASET.financier]!;
  const financierName = DATASET.organisations[DATASET.financier]!.name;

  const projects: Record<string, { id: string; name: string }> = {};
  for (const p of DATASET.projects) {
    const created = await db.project.create({
      data: { builderId: orgs[p.builder]!.id, code: p.code, name: p.name, city: p.city, location: p.location, reraNumber: p.reraNumber, createdAt: at("2026-03-25") },
    });
    projects[p.key] = { id: created.id, name: created.name };
  }

  for (const e of DATASET.empanelments) {
    await db.cpBuilderRelationship.create({
      data: { cpId: orgs[e.cp]!.id, builderId: orgs[e.builder]!.id, empanelmentCode: e.code, creditPeriodDays: e.creditPeriodDays, empanelledAt: at("2026-04-01") },
    });
  }

  const programmes = {} as Record<string, { id: string; bps: number; code: string; name: string; terms: string }>;
  for (const def of DATASET.programmes) {
    const created = await db.financingProgramme.create({
      data: {
        code: def.code,
        name: def.name,
        builderId: orgs[def.builder]!.id,
        financierId: financierOrg.id,
        discountRateBps: def.bps,
        status: "ACTIVE",
        effectiveFrom: dateOnly("2026-04-01"),
        offerValidityDays: 7,
        terms: def.terms,
        createdById: admin.userId,
        createdAt: at("2026-03-28"),
      },
    });
    programmes[def.builder] = { id: created.id, bps: def.bps, code: def.code, name: def.name, terms: def.terms };
    await audit(admin, "programme.created", "FinancingProgramme", created.id, `Created programme ${def.code} for ${orgs[def.builder]!.name} at ${def.bps / 100}% (active)`, at("2026-03-28"), {
      discountRateBps: def.bps,
    });
  }
  await db.sequence.create({ data: { name: "programme", value: DATASET.programmes.length } });

  const invoices = DATASET.invoices(CLOCK);

  for (const inv of invoices) {
    const doc = buildInvoiceDocument(inv, DATASET);
    const pdf = await renderBrokerageInvoicePdf(doc);
    const storageKey = `invoices/seed/${randomUUID()}.pdf`;
    await mkdir(path.join(STORAGE_ROOT, "invoices", "seed"), { recursive: true });
    await writeFile(path.join(STORAGE_ROOT, storageKey), pdf);

    const gst = splitGstInclusive(inv.amountPaise, GST_RATE_PERCENT, doc.gst!.mode);
    const cpUser = userFor(inv.cp, "CP_ADMIN");
    const builderUser = userFor(inv.builder, "BUILDER_ACCOUNTS");
    const invoiceRef = reference("BF-INV");
    const approved = inv.status === "ACCEPTED" ? (inv.review?.approvedAmountPaise ?? inv.amountPaise) : null;

    const created = await db.invoice.create({
      data: {
        reference: invoiceRef,
        invoiceNumber: inv.invoiceNumber,
        cpId: orgs[inv.cp]!.id,
        builderId: orgs[inv.builder]!.id,
        projectId: projects[inv.project]!.id,
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
    await audit(cpUser, "invoice.submitted", "Invoice", created.id, `Submitted invoice ${inv.invoiceNumber} (${invoiceRef}) to ${orgs[inv.builder]!.name}`, inv.submittedAt, {
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
      "I confirm that I wish to receive early payment for this builder-approved invoice at the discount shown. I understand the discount is deducted upfront, that the net amount will be paid to my registered bank account, and that the builder will settle the full approved amount with the financier on the original due date.";
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
          financier: financierName,
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
        cpId: orgs[inv.cp]!.id,
        builderId: orgs[inv.builder]!.id,
        financierId: financierOrg.id,
        approvedAmountPaise: calc.approvedAmountPaise,
        discountRateBps: calc.discountRateBps,
        discountAmountPaise: calc.discountAmountPaise,
        chargesPaise: 0n,
        netPayablePaise: calc.netPayablePaise,
        status: f.stage,
        acceptedById: cpUser.userId,
        acceptedAt: f.acceptedAt,
        decidedById: f.decidedAt ? financeOps.userId : null,
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
      await event("PENDING_APPROVAL", "APPROVED", financeOps, f.decidedAt, "Within programme limits; KYC on file.");
      await audit(financeOps, "financing.approved", "FinancingRequest", request.id, `Approved financing request ${requestRef}`, f.decidedAt);
    }
    if (f.disbursedAt) {
      const paymentRef = reference("BFPAY-DEMO");
      const cpOrg = DATASET.organisations[inv.cp]!;
      const account = cpOrg.bankAccountNumber ?? "0000";
      const completed = Boolean(f.completedAt);
      await db.disbursement.create({
        data: {
          requestId: request.id,
          reference: paymentRef,
          amountPaise: calc.netPayablePaise,
          status: completed ? "SUCCESS" : "INITIATED",
          beneficiaryName: cpOrg.legalName,
          beneficiaryAccount: `XXXX${account.slice(-4)}`,
          beneficiaryIfsc: cpOrg.bankIfsc ?? "DEMO0000001",
          utr: completed ? `DEMOUTR2026${String(100000000 + counters.get("BFPAY-DEMO:2026")! * 7919).slice(0, 9)}` : null,
          initiatedById: financeOps.userId,
          initiatedAt: f.disbursedAt,
          completedById: completed ? financeOps.userId : null,
          completedAt: f.completedAt ?? null,
        },
      });
      await event("APPROVED", "DISBURSEMENT_INITIATED", financeOps, f.disbursedAt, `Payout ${paymentRef} initiated`);
      await audit(financeOps, "disbursement.initiated", "Disbursement", request.id, `Initiated disbursement ${paymentRef}`, f.disbursedAt, { simulated: true });
      if (completed) {
        await event("DISBURSEMENT_INITIATED", "DISBURSED", financeOps, f.completedAt!, "Transfer confirmed");
        await audit(financeOps, "disbursement.completed", "Disbursement", request.id, `Disbursement for ${requestRef} completed`, f.completedAt!, { simulated: true });
        const due = inv.dueDate ? dateOnly(inv.dueDate) : new Date(dateOnly(inv.invoiceDate).getTime() + 60 * DAY);
        const settlement = await db.settlement.create({
          data: {
            requestId: request.id,
            builderId: orgs[inv.builder]!.id,
            financierId: financierOrg.id,
            amountPaise: calc.approvedAmountPaise,
            dueDate: due,
            status: f.settledAt ? "SETTLED" : due.getTime() > NOW.getTime() ? "NOT_DUE" : "OVERDUE",
            reference: f.settledAt ? `NEFT-DEMO-${inv.invoiceNumber.replace(/\W+/g, "-")}` : null,
            settledAt: f.settledAt ?? null,
            settledById: f.settledAt ? financeOps.userId : null,
            note: f.settledAt ? "Received from builder on due date." : null,
            createdAt: f.completedAt!,
          },
        });
        if (f.settledAt) {
          await audit(financeOps, "settlement.settled", "Settlement", settlement.id, `Marked settlement for ${requestRef} as settled`, f.settledAt);
        }
      }
    }
  }

  for (const comment of DATASET.internalComments?.(CLOCK) ?? []) {
    const author = users[comment.author]!;
    const request = await db.financingRequest.findFirstOrThrow({ where: { invoice: { invoiceNumber: comment.invoiceNumber } } });
    await db.internalComment.create({ data: { requestId: request.id, body: comment.body, authorId: author.userId, authorName: author.name, createdAt: comment.createdAt } });
  }

  await persistSequences();
  await db.platformSetting.createMany({
    data: [
      { key: "platform.supportEmail", value: "support@brickflow.demo", updatedById: admin.userId },
      { key: "platform.defaultCreditPeriodDays", value: "60", updatedById: admin.userId },
    ],
  });

  const summary = await Promise.all([db.organisation.count(), db.user.count(), db.invoice.count(), db.financingRequest.count()]);
  console.log(`Seeded dataset "${DATASET.key}": ${summary[0]} organisations, ${summary[1]} users, ${summary[2]} invoices, ${summary[3]} financing requests.`);
  if (process.env.NODE_ENV !== "production") console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
