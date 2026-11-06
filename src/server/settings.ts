import "server-only";
import { z } from "zod";
import { db } from "./db";
import { logger } from "./observability/logger";

export const SETTING_DEFINITIONS = {
  "platform.supportEmail": { label: "Support email", description: "Shown to users in the footer and in help text.", default: "support@brickflow.demo" },
  "platform.defaultCreditPeriodDays": {
    label: "Default credit period (days)",
    description: "Sets the settlement due date when an invoice has no due date and no empanelment credit period applies.",
    default: "60",
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_VALIDATORS: Record<SettingKey, z.ZodType<string>> = {
  "platform.supportEmail": z.email("Enter a valid email"),
  "platform.defaultCreditPeriodDays": z.string().regex(/^\d{1,3}$/, "Enter a number of days").refine((v) => Number(v) >= 1 && Number(v) <= 365, "Between 1 and 365"),
};

/** Settings whose value is a whole number. */
export type NumericSettingKey = "platform.defaultCreditPeriodDays";

/** All settings, falling back to the documented default for any key that is not stored. */
export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.platformSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => [key, map.get(key) ?? SETTING_DEFINITIONS[key].default]),
  ) as Record<SettingKey, string>;
}

/** A stored setting, or its default when it is missing or fails validation (which is logged). */
export async function getSettingString(key: SettingKey): Promise<string> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  const fallback = SETTING_DEFINITIONS[key].default;
  if (!row) return fallback;
  if (!SETTING_VALIDATORS[key].safeParse(row.value).success) {
    logger.warn("settings.invalid_value", { key, fallback });
    return fallback;
  }
  return row.value;
}

export async function getSettingNumber(key: NumericSettingKey): Promise<number> {
  return Number.parseInt(await getSettingString(key), 10);
}
