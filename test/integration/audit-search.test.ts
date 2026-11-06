import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { decodeAuditCursor, getAuditFilterOptions, MAX_AUDIT_EXPORT_ROWS, parseAuditFilters, searchAuditLogs } from "@/server/queries/audit";
import { actors, expectDomainError, type DemoUser } from "./helpers";

const session = vi.hoisted(() => ({ actor: null as Actor | null, countOverride: null as number | null }));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/auth/session")>();
  return { ...original, getActor: async () => session.actor };
});

vi.mock("@/server/queries/audit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/queries/audit")>();
  return {
    ...original,
    countAuditLogs: (...args: Parameters<typeof original.countAuditLogs>) =>
      session.countOverride === null ? original.countAuditLogs(...args) : Promise.resolve(session.countOverride),
  };
});

const { GET: exportGET } = await import("@/app/api/admin/audit/export/route");

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

function exportRequest(query = "") {
  const url = new URL(`http://localhost/api/admin/audit/export${query}`);
  return Object.assign(new Request(url), { nextUrl: url }) as unknown as Parameters<typeof exportGET>[0];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

describe("audit log search", () => {
  it("parses only well-formed filters", () => {
    expect(parseAuditFilters(new URLSearchParams("from=2026-02-30&to=2026-11-06&action=%20invoice.approved%20&q=&unknown=1"))).toEqual({ to: "2026-11-06", action: "invoice.approved" });
    expect(parseAuditFilters({ from: ["2026-01-01", "2026-02-01"], entity: "Invoice" })).toEqual({ from: "2026-01-01", entity: "Invoice" });
  });

  it("filters by action, record type, record ID, actor and organisation", async () => {
    const approved = await searchAuditLogs(as.admin, { action: "invoice.approved" }, { limit: 200 });
    expect(approved.entries.length).toBeGreaterThan(0);
    expect(approved.entries.every((e) => e.action === "invoice.approved")).toBe(true);

    const invoices = await searchAuditLogs(as.admin, { entity: "Invoice" }, { limit: 200 });
    expect(invoices.entries.every((e) => e.entityType === "Invoice")).toBe(true);

    const one = invoices.entries[0]!;
    const byId = await searchAuditLogs(as.admin, { entityId: one.entityId }, { limit: 200 });
    expect(byId.entries.length).toBeGreaterThan(0);
    expect(byId.entries.every((e) => e.entityId === one.entityId)).toBe(true);

    const byActor = await searchAuditLogs(as.admin, { actor: as.godrej.userId }, { limit: 200 });
    expect(byActor.entries.length).toBeGreaterThan(0);
    expect(byActor.entries.every((e) => e.actorUserId === as.godrej.userId)).toBe(true);

    const byOrg = await searchAuditLogs(as.admin, { org: as.prestige.orgId }, { limit: 200 });
    expect(byOrg.entries.length).toBeGreaterThan(0);
    expect(byOrg.entries.every((e) => e.actorOrgId === as.prestige.orgId)).toBe(true);
  });

  it("filters by India Standard Time calendar days, inclusive of both ends", async () => {
    const at = (iso: string) => new Date(iso);
    const marker = `range-${Date.now()}`;
    const times = ["2025-03-09T18:29:59.999Z", "2025-03-09T18:30:00.000Z", "2025-03-11T18:29:59.999Z", "2025-03-11T18:30:00.000Z"];
    const { appendAuditEntry } = await import("@/lib/audit-chain");
    for (const [i, t] of times.entries()) {
      await db.$transaction((tx) =>
        appendAuditEntry(tx, { actorUserId: null, actorName: "System", actorOrgId: null, actorRole: null, action: "test.range", entityType: "Session", entityId: `${marker}-${i}`, summary: marker, metadata: null, createdAt: at(t) }),
      );
    }
    const page = await searchAuditLogs(as.admin, { from: "2025-03-10", to: "2025-03-11", q: marker }, { limit: 200 });
    expect(page.entries.map((e) => e.entityId).sort()).toEqual([`${marker}-1`, `${marker}-2`]);
  });

  it("pages beyond the old 500-entry cap with a stable keyset cursor", async () => {
    const total = await db.auditLog.count();
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await searchAuditLogs(as.admin, {}, { cursor, limit: 7 });
      for (const entry of page.entries) {
        expect(seen.has(entry.id)).toBe(false);
        seen.add(entry.id);
      }
      for (let i = 1; i < page.entries.length; i++) {
        const [a, b] = [page.entries[i - 1]!, page.entries[i]!];
        expect(a.createdAt > b.createdAt || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id)).toBe(true);
      }
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 1_000);
    expect(seen.size).toBe(total);
    expect(pages).toBe(Math.ceil(total / 7));
  });

  it("ignores a cursor issued for different filters or tampered with", async () => {
    const first = await searchAuditLogs(as.admin, { entity: "Invoice" }, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    expect(decodeAuditCursor(first.nextCursor!, { entity: "Invoice" })).not.toBeNull();
    expect(decodeAuditCursor(first.nextCursor!, { entity: "User" })).toBeNull();
    expect(decodeAuditCursor("not-a-cursor", {})).toBeNull();
    const switched = await searchAuditLogs(as.admin, { entity: "User" }, { cursor: first.nextCursor!, limit: 2 });
    expect(switched.paged).toBe(false);
  });

  it("limits other organisations to their own entries and keeps filter options for administrators", async () => {
    const own = await searchAuditLogs(as.godrej, { org: as.prestige.orgId }, { limit: 200 });
    expect(own.entries).toHaveLength(0);
    const scoped = await searchAuditLogs(as.godrej, {}, { limit: 200 });
    expect(scoped.entries.every((e) => e.actorOrgId === as.godrej.orgId)).toBe(true);
    await expectDomainError(getAuditFilterOptions(as.godrej), "FORBIDDEN");
    const options = await getAuditFilterOptions(as.admin);
    expect(options.actions).toContain("invoice.approved");
    expect(options.actors.map((a) => a.id)).toContain(as.godrej.userId);
  });
});

describe("audit log CSV export", () => {
  it("requires a platform administrator", async () => {
    session.actor = null;
    expect((await exportGET(exportRequest())).status).toBe(401);
    session.actor = as.finance;
    expect((await exportGET(exportRequest())).status).toBe(403);
  });

  it("exports the filtered entries, neutralises spreadsheet formulas and records the export", async () => {
    const marker = `csv-${Date.now()}`;
    const { appendAuditEntry } = await import("@/lib/audit-chain");
    await db.$transaction((tx) =>
      appendAuditEntry(tx, {
        actorUserId: as.prestige.userId,
        actorName: "=HYPERLINK(\"http://evil\")",
        actorOrgId: as.prestige.orgId,
        actorRole: "CP_ADMIN",
        action: "test.csv",
        entityType: "Invoice",
        entityId: marker,
        summary: "+cmd|' /C calc'!A0, with \"quotes\"\nand a new line",
        metadata: '{"note":"@SUM(1,2)"}',
      }),
    );
    session.actor = as.admin;
    const response = await exportGET(exportRequest(`?entityId=${marker}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="brickflow-audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes));
    expect(rows[0]).toEqual(["Sequence", "Recorded at (UTC)", "Actor", "Actor user ID", "Actor role", "Organisation", "Organisation ID", "Action", "Record type", "Record ID", "Summary", "Recorded values", "Entry hash", "Previous entry hash"]);
    expect(rows).toHaveLength(2);
    const row = rows[1]!;
    expect(row[2]).toBe("'=HYPERLINK(\"http://evil\")");
    expect(row[5]).toBe(as.prestige.orgName);
    expect(row[9]).toBe(marker);
    expect(row[10]).toBe("'+cmd|' /C calc'!A0, with \"quotes\"\nand a new line");
    expect(row[11]).toBe('{"note":"@SUM(1,2)"}');
    expect(row[12]).toMatch(/^[0-9a-f]{64}$/);

    const recorded = await db.auditLog.findFirstOrThrow({ where: { action: "audit.exported" }, orderBy: { seq: "desc" } });
    expect(recorded).toMatchObject({ actorUserId: as.admin.userId, entityType: "AuditLog" });
    expect(JSON.parse(recorded.metadata!)).toEqual({ filters: { entityId: marker }, rows: 1 });
  });

  it("refuses exports above the row limit", async () => {
    session.actor = as.admin;
    session.countOverride = MAX_AUDIT_EXPORT_ROWS + 1;
    try {
      const response = await exportGET(exportRequest());
      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatch(/Narrow the date range/);
    } finally {
      session.countOverride = null;
    }
  });
});
