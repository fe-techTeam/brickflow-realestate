/**
 * Shared Recharts theme for BrickFlow charts.
 *
 * - Single-series charts use CHART_COLORS.primary (midnight navy) and may highlight one mark in gold.
 * - Multi-series charts take CHART_SERIES in fixed order (never cycled). The order was checked for
 *   lightness band, chroma, colour-blind separation and contrast on white; slot 4 (sky) sits under 3:1
 *   on white, so charts using it must show a legend and/or a data table (ChartFrame provides both).
 * - Text never takes a series colour: ticks and labels use CHART_COLORS.ink.
 */
export const CHART_COLORS = {
  primary: "#142b43",
  primarySoft: "#97abc2",
  gold: "#c4a46a",
  goldDeep: "#a98a52",
  positive: "#174d3c",
  positiveSoft: "#7fae95",
  negative: "#9b3a2e",
  warning: "#c48a2c",
  ink: "#6b7684",
  inkStrong: "#303d4d",
  grid: "#ece7db",
  axis: "#e0d9c8",
  cursor: "rgba(196, 164, 106, 0.10)",
  surface: "#ffffff",
} as const;

/** Categorical series colours, in assignment order. */
export const CHART_SERIES = ["#2d5b91", "#b8892f", "#1c8261", "#5e9bd0", "#a65a3a"] as const;

export const CHART_FONT_FAMILY = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";

export const chartAxisTick = {
  fill: CHART_COLORS.ink,
  fontSize: 11,
  fontFamily: CHART_FONT_FAMILY,
  fontVariantNumeric: "tabular-nums lining-nums",
} as const;

/** Spread onto <XAxis>. */
export const chartXAxisProps = {
  tick: chartAxisTick,
  tickLine: false,
  axisLine: { stroke: CHART_COLORS.axis },
  tickMargin: 10,
} as const;

/** Spread onto <YAxis>. */
export const chartYAxisProps = {
  tick: chartAxisTick,
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  width: 72,
} as const;

/** Spread onto <CartesianGrid>. */
export const chartGridProps = {
  stroke: CHART_COLORS.grid,
  strokeDasharray: "2 4",
  vertical: false,
} as const;

/** Spread onto <Tooltip> when not supplying a custom `content` (prefer ChartTooltipCard). */
export const chartTooltipProps = {
  cursor: { fill: CHART_COLORS.cursor, stroke: "none" },
  contentStyle: {
    background: CHART_COLORS.surface,
    border: "1px solid #e4ded1",
    borderRadius: 10,
    boxShadow: "0 1px 2px rgba(20,43,67,.05), 0 8px 18px -8px rgba(20,43,67,.12), 0 28px 56px -28px rgba(20,43,67,.28)",
    padding: "10px 12px",
    fontFamily: CHART_FONT_FAMILY,
    fontSize: 12,
  },
  labelStyle: { color: CHART_COLORS.primary, fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: CHART_COLORS.inkStrong, padding: 0 },
} as const;

/** Spread onto <Bar>: thin, rounded data-ends anchored to the baseline. */
export const chartBarProps = {
  radius: [4, 4, 0, 0] as [number, number, number, number],
  maxBarSize: 36,
} as const;

/** Spread onto <Line>. */
export const chartLineProps = {
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4.5, strokeWidth: 2, stroke: CHART_COLORS.surface },
  type: "monotone",
} as const;

/** Spread onto <Legend> when not using ChartFrame's legend. */
export const chartLegendProps = {
  iconType: "circle",
  iconSize: 8,
  wrapperStyle: { fontSize: 12, color: CHART_COLORS.inkStrong, fontFamily: CHART_FONT_FAMILY },
} as const;

/** Stroke and fill for an <Area> under a line (fades to transparent). Reference the gradient by id. */
export function chartAreaGradientStops(color: string) {
  return [
    { offset: "0%", color, opacity: 0.18 },
    { offset: "100%", color, opacity: 0 },
  ] as const;
}
