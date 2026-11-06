import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { setLogSink, type LogRecord } from "@/server/observability/logger";
import { updateSettings } from "@/server/services/admin";
import { acceptOffer, approveFinancingRequest, completeDisbursement, generateOffer, initiateDisbursement } from "@/server/services/financing";
import { getSettingNumber, getSettingString } from "@/server/settings";
import { acceptedInvoice, actors, isoDate, utcDate, type DemoUser } from "./helpers";

const KEY = "platform.defaultCreditPeriodDays";
let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

afterEach(async () => {
  await db.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: "60" }, update: { value: "60" } });
});

describe("typed settings", () => {
  it("reads the stored number and falls back to the default when the setting is missing", async () => {
    expect(await getSettingNumber(KEY)).toBe(60);
    await updateSettings(as.admin, { [KEY]: "45" });
    expect(await getSettingNumber(KEY)).toBe(45);
    await db.platformSetting.delete({ where: { key: KEY } });
    expect(await getSettingNumber(KEY)).toBe(60);
  });

  it("ignores an invalid stored value, logging a warning", async () => {
    await db.platformSetting.update({ where: { key: KEY }, data: { value: "ninety" } });
    const logs: LogRecord[] = [];
    const restore = setLogSink((record) => logs.push(record));
    try {
      expect(await getSettingNumber(KEY)).toBe(60);
    } finally {
      restore();
    }
    expect(logs[0]).toMatchObject({ level: "warn", message: "settings.invalid_value", key: KEY });
  });

  it("serves the support email", async () => {
    expect(await getSettingString("platform.supportEmail")).toBe("support@brickflow.demo");
  });
});

describe("settlement due date fallback", () => {
  it("uses the platform default credit period when the invoice has no due date and no empanelment applies", async () => {
    const invoiceDate = isoDate(-5);
    const invoice = await acceptedInvoice(as.prestige, as.godrej, { dueDate: null, invoiceDate, amount: "120000" });
    const offer = await generateOffer(as.prestige, invoice.id);
    const request = await acceptOffer(as.prestige, offer.id, { consent: true });
    await approveFinancingRequest(as.finance, request.id, {});
    await initiateDisbursement(as.finance, request.id);
    await updateSettings(as.admin, { [KEY]: "45" });

    const relationship = await db.cpBuilderRelationship.findUniqueOrThrow({ where: { cpId_builderId: { cpId: as.prestige.orgId, builderId: as.godrej.orgId } } });
    await db.cpBuilderRelationship.delete({ where: { id: relationship.id } });
    try {
      await completeDisbursement(as.finance, request.id);
    } finally {
      await db.cpBuilderRelationship.create({ data: relationship });
    }

    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(settlement.dueDate.toISOString()).toBe(new Date(utcDate(invoiceDate).getTime() + 45 * 24 * 60 * 60 * 1000).toISOString());
  });
});
