import { describe, expect, it } from "vitest";
import { calculateDiscount } from "../financing";
import { demoAccountsFor } from "../workspaces";
import { buildInvoiceDocument, DEMO_DATASETS, demoClock, resolveDemoDataset } from "./catalogue";

const clock = demoClock(new Date("2026-11-03T06:30:00.000Z"));

describe.each(Object.values(DEMO_DATASETS))("dataset $key", (dataset) => {
  const invoices = dataset.invoices(clock);
  const samples = dataset.samples(clock);
  const orgType = (key: string) => dataset.organisations[key]?.type;

  it("references only organisations and projects it defines", () => {
    for (const user of dataset.users) expect(dataset.organisations[user.org], user.email).toBeDefined();
    for (const p of dataset.projects) expect(orgType(p.builder)).toBe("BUILDER");
    for (const e of dataset.empanelments) {
      expect(orgType(e.cp)).toBe("CHANNEL_PARTNER");
      expect(orgType(e.builder)).toBe("BUILDER");
    }
    for (const doc of [...invoices, ...samples]) {
      expect(() => buildInvoiceDocument(doc, dataset)).not.toThrow();
      expect(dataset.projects.find((p) => p.key === doc.project)?.builder).toBe(doc.builder);
      expect(dataset.empanelments.some((e) => e.cp === doc.cp && e.builder === doc.builder), doc.invoiceNumber).toBe(true);
    }
    expect(orgType(dataset.financier)).toBe("FINANCIER");
  });

  it("has a user for every party that acts in the workflow", () => {
    const hasUser = (org: string, role: string) => dataset.users.some((u) => u.org === org && u.role === role);
    expect(hasUser("platform", "SUPER_ADMIN")).toBe(true);
    expect(hasUser(dataset.financier, "FINANCE_OPS")).toBe(true);
    for (const inv of invoices) {
      expect(hasUser(inv.cp, "CP_ADMIN")).toBe(true);
      expect(hasUser(inv.builder, "BUILDER_ACCOUNTS")).toBe(true);
    }
  });

  it("offers one sign-in card per workspace", () => {
    const cards = demoAccountsFor(dataset.users, (key) => dataset.organisations[key]!.name);
    expect(cards.map((c) => c.workspace)).toEqual(["partner", "builder", "finance", "admin"]);
  });

  it("uses unique invoice numbers per channel partner and builder", () => {
    const keys = invoices.map((i) => `${i.cp}|${i.builder}|${i.invoiceNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Chandak pitch dataset", () => {
  const dataset = resolveDemoDataset("chandak");
  const invoices = dataset.invoices(clock);

  it("has one builder, one channel partner and two invoices: one accepted, one awaiting approval", () => {
    const types = Object.values(dataset.organisations).map((o) => o.type);
    expect(types.filter((t) => t === "BUILDER")).toHaveLength(1);
    expect(types.filter((t) => t === "CHANNEL_PARTNER")).toHaveLength(1);
    expect(invoices.map((i) => i.status).sort()).toEqual(["ACCEPTED", "SUBMITTED"]);
    expect(invoices.every((i) => !i.financing)).toBe(true);
    expect(dataset.organisations.chandak?.name).toBe("Chandak Group");
  });

  it("keeps the accepted invoice eligible and the figures simple", () => {
    const accepted = invoices.find((i) => i.status === "ACCEPTED")!;
    expect(accepted.dueDate! > clock.isoDate(0)).toBe(true);
    const calc = calculateDiscount(accepted.amountPaise, dataset.programmes[0]!.bps);
    expect(calc.discountAmountPaise).toBe(15_000_00n);
    expect(calc.netPayablePaise).toBe(4_85_000_00n);
  });

  it("offers sample invoices that have not been seeded, so they can be uploaded live", () => {
    const seeded = new Set(invoices.map((i) => i.invoiceNumber));
    const samples = dataset.samples(clock);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(seeded.has(s.invoiceNumber)).toBe(false);
  });
});

describe("resolveDemoDataset", () => {
  it("defaults to the standard dataset and rejects unknown names", () => {
    expect(resolveDemoDataset(undefined).key).toBe("standard");
    expect(() => resolveDemoDataset("nope")).toThrow(/Unknown DEMO_DATASET/);
  });
});
