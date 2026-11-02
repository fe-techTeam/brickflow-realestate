import { formatINRCompact } from "@/lib/money";

/**
 * Categorical chart palette, validated for colour-vision deficiency separation and 3:1 contrast on white
 * in this fixed order. Hues stay tied to their meaning across charts (green = approved / financed / settled).
 */
export const CHART_COLORS = {
  green: "#1f8a64",
  blue: "#2563a0",
  gold: "#b8893a",
  rose: "#a3485a",
} as const;

export const CHART_INK = {
  axis: "#5f6b78",
  grid: "#ece7db",
  cursor: "rgba(20, 43, 67, 0.05)",
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
