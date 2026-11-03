import { CHART_COLORS as THEME } from "@/components/common/chart-theme";
import { formatINRCompact } from "@/lib/money";

/** Builder chart hues, drawn from the shared theme and tied to meaning (leaf = approved / settled). */
export const CHART_COLORS = {
  basalt: THEME.primary,
  basaltSoft: THEME.primarySoft,
  leaf: THEME.positive,
  kota: THEME.kotaDeep,
  rose: THEME.negative,
} as const;

export const CHART_INK = {
  axis: THEME.ink,
  grid: THEME.grid,
  cursor: THEME.cursor,
} as const;

/** Whole rupees (chart scale) to the compact INR label used across the app. */
export function compactRupees(rupees: number): string {
  return formatINRCompact(BigInt(Math.round(rupees)) * 100n);
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/** Short axis tick labels: ₹1.2 Cr, ₹8 L, ₹40K. */
export function axisRupees(rupees: number): string {
  if (rupees === 0) return "₹0";
  if (rupees >= 1_00_00_000) return `₹${trim(rupees / 1_00_00_000)} Cr`;
  if (rupees >= 1_00_000) return `₹${trim(rupees / 1_00_000)} L`;
  if (rupees >= 1_000) return `₹${trim(rupees / 1_000)}K`;
  return `₹${Math.round(rupees)}`;
}
