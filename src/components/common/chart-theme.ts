/**
 * Shared Recharts theme for BrickFlow charts.
 *
 * - Single-series charts use CHART_COLORS.primary (basalt) and may highlight one mark with the accent.
 * - Multi-series charts take CHART_SERIES in fixed order (never cycled). The order was checked for
 *   lightness band, chroma, colour-blind separation and contrast on white; slot 5 (mist) is the quietest
 *   on white, so charts using it must show a legend and/or a data table (ChartFrame provides both).
 * - Text never takes a series colour: ticks and labels use CHART_COLORS.ink.
 */
export const CHART_COLORS = {
  primary: "#e8eef5",
  primarySoft: "#9fb0c3",
  kota: "#c9d3df",
  kotaDeep: "#aebbc9",
  accent: "#ffc247",
  positive: "#3abf94",
  positiveSoft: "#2f9e7a",
  negative: "#f4876e",
  warning: "#ff9f5a",
  ink: "#c3cdd8",
  inkStrong: "#f5f8fb",
  grid: "rgba(255, 255, 255, 0.1)",
  axis: "rgba(255, 255, 255, 0.18)",
  cursor: "rgba(255, 255, 255, 0.06)",
  surface: "#2b394c",
} as const;

/** Categorical series colours, in assignment order. */
export const CHART_SERIES = ["#ffc247", "#3abf94", "#f4876e", "#a98bff", "#c9d3df"] as const;

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
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    boxShadow: "0 1px 2px rgba(8, 14, 24,.05), 0 8px 18px -8px rgba(8, 14, 24,.12), 0 28px 56px -28px rgba(8, 14, 24,.28)",
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
