/**
 * Money helpers. All amounts are integer paise (BigInt) end-to-end; floats are never used
 * for persisted or calculated values. Formatting splits rupees/paise to stay exact.
 */

export type PaiseLike = bigint | number | string;

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

export function toPaise(value: PaiseLike): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError("Paise must be a safe integer");
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new RangeError(`Invalid paise value: ${value}`);
  return BigInt(value);
}

/** Parses a rupee amount typed by a user ("5,00,000.50") into paise. Returns null when invalid. */
export function parseRupeesToPaise(input: string): bigint | null {
  const cleaned = input.replace(/[,\s₹]/g, "");
  if (!AMOUNT_PATTERN.test(cleaned)) return null;
  const [rupees, fraction = ""] = cleaned.split(".");
  return BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** Plain decimal string for form inputs, e.g. 50000050n -> "500000.50". */
export function paiseToDecimalString(paise: PaiseLike): string {
  const value = toPaise(paise);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rupees = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${rupees.toString()}.${fraction}`;
}

const groupFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Indian-grouped currency string, e.g. 50000000n -> "₹5,00,000.00". */
export function formatINR(paise: PaiseLike, options: { showPaise?: boolean; symbol?: boolean } = {}): string {
  const { showPaise = true, symbol = true } = options;
  const value = toPaise(paise);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rupees = groupFormatter.format(abs / 100n);
  const fraction = (abs % 100n).toString().padStart(2, "0");
  const body = showPaise ? `${rupees}.${fraction}` : rupees;
  return `${negative ? "-" : ""}${symbol ? "₹" : ""}${body}`;
}

/** Compact Indian notation for dashboards: ₹4.85 L, ₹1.20 Cr. */
export function formatINRCompact(paise: PaiseLike): string {
  const value = toPaise(paise);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? "-" : "";
  const crore = 100n * 100_00_000n;
  const lakh = 100n * 1_00_000n;
  const scaled = (unit: bigint, suffix: string) => {
    const hundredths = (abs * 100n + unit / 2n) / unit;
    const whole = hundredths / 100n;
    const frac = (hundredths % 100n).toString().padStart(2, "0");
    return `${sign}₹${groupFormatter.format(whole)}.${frac} ${suffix}`;
  };
  if (abs >= crore) return scaled(crore, "Cr");
  if (abs >= lakh) return scaled(lakh, "L");
  return `${sign}${formatINR(abs, { showPaise: false })}`;
}

/** Parses a percentage typed by a user ("2.5") into basis points (250). Returns null when invalid. */
export function parsePercentToBps(input: string): number | null {
  const cleaned = input.trim().replace(/%$/, "");
  if (!PERCENT_PATTERN.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** 250 -> "2.5%", 300 -> "3%", 275 -> "2.75%". */
export function formatBps(bps: number, options: { suffix?: boolean } = {}): string {
  const { suffix = true } = options;
  const whole = Math.trunc(bps / 100);
  const fraction = (bps % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}${suffix ? "%" : ""}`;
}

export function bpsToDecimalString(bps: number): string {
  return `${Math.trunc(bps / 100)}.${(bps % 100).toString().padStart(2, "0")}`;
}

export function sumPaise(values: Iterable<bigint | null | undefined>): bigint {
  let total = 0n;
  for (const v of values) total += v ?? 0n;
  return total;
}
