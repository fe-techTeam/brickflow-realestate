import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/session";
import { listOrganisations, listProgrammes } from "@/server/services/admin";
import { listInvoices } from "@/server/services/invoices";
import { actors, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

const isSorted = (values: string[]) => values.every((v, i) => i === 0 || values[i - 1]! <= v);

describe("search", () => {
  it("matches regardless of letter case", async () => {
    const all = await listInvoices(as.admin);
    const sample = all.find((i) => /[a-z]/i.test(i.builder.name))!;

    for (const search of [sample.builder.name.toLowerCase(), sample.builder.name.toUpperCase()]) {
      const ids = (await listInvoices(as.admin, { search })).map((i) => i.id);
      expect(ids).toContain(sample.id);
    }
    const byReference = await listInvoices(as.admin, { search: sample.reference.toLowerCase() });
    expect(byReference.map((i) => i.id)).toContain(sample.id);
  });

  it("matches organisations regardless of letter case", async () => {
    const [first] = await listOrganisations(as.admin);
    const found = await listOrganisations(as.admin, { search: first!.name.toLowerCase() });
    expect(found.map((o) => o.id)).toContain(first!.id);
  });
});

describe("ordering", () => {
  it("groups organisations by type name alphabetically", async () => {
    const types = (await listOrganisations(as.admin)).map((o) => o.type);
    expect(new Set(types).size).toBeGreaterThan(1);
    expect(isSorted(types)).toBe(true);
  });

  it("groups programmes by status name alphabetically", async () => {
    const statuses = (await listProgrammes(as.admin)).map((p) => p.status);
    expect(isSorted(statuses)).toBe(true);
  });
});
