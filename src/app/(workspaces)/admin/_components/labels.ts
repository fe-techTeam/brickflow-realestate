import type { OrganisationType } from "@/generated/prisma/enums";
import type { StatusMeta } from "@/lib/status";

export const ORG_TYPE_META: Record<OrganisationType, StatusMeta> = {
  PLATFORM: { label: "Platform", tone: "basalt" },
  FINANCIER: { label: "Financier", tone: "kota" },
  BUILDER: { label: "Builder", tone: "info" },
  CHANNEL_PARTNER: { label: "Channel partner", tone: "success" },
};

export const ORG_TYPE_OPTIONS = (Object.keys(ORG_TYPE_META) as OrganisationType[]).map((value) => ({ value, label: ORG_TYPE_META[value].label }));

export const ENTITY_LABELS: Record<string, string> = {
  Organisation: "Organisation",
  User: "User",
  Invoice: "Invoice",
  FinancingProgramme: "Financing programme",
  FinancingOffer: "Financing offer",
  FinancingRequest: "Financing request",
  Disbursement: "Disbursement",
  Settlement: "Settlement",
  PlatformSetting: "Platform setting",
  Session: "Session",
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  FINANCE_OPS: "Finance ops",
  BUILDER_ACCOUNTS: "Builder accounts",
  CP_ADMIN: "CP admin",
};

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Masks all but the last four characters of an account number. */
export function maskAccount(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 4 ? value : `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

/** "1 invoice", "3 invoices". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
