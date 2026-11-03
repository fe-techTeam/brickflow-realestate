import { describe, expect, it } from "vitest";
import {
  bpsToDecimalString,
  formatBps,
  formatINR,
  formatINRCompact,
  paiseToDecimalString,
  parsePercentToBps,
  parseRupeesToPaise,
  sumPaise,
  toPaise,
} from "./money";

describe("parseRupeesToPaise", () => {
  it.each([
    ["500000", 5_00_000_00n],
    ["5,00,000.50", 5_00_000_50n],
    ["₹ 1,000", 1_000_00n],
    ["12.5", 12_50n],
    ["0.05", 5n],
    ["0", 0n],
  ])("parses %s", (input, expected) => {
    expect(parseRupeesToPaise(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "-5", "1e5", "12.", ".5", "5.0.0"])("rejects %j", (input) => {
    expect(parseRupeesToPaise(input)).toBeNull();
  });
});

describe("toPaise", () => {
  it("accepts bigint, safe integers and integer strings", () => {
    expect(toPaise(15n)).toBe(15n);
    expect(toPaise(1500)).toBe(1500n);
    expect(toPaise("-12")).toBe(-12n);
  });

  it("rejects fractional or unsafe values", () => {
    expect(() => toPaise(1.5)).toThrow(RangeError);
    expect(() => toPaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => toPaise("12.5")).toThrow(RangeError);
  });
});

describe("paiseToDecimalString", () => {
  it("renders a plain two-decimal string", () => {
    expect(paiseToDecimalString(5_00_000_50n)).toBe("500000.50");
    expect(paiseToDecimalString(7n)).toBe("0.07");
    expect(paiseToDecimalString(-5n)).toBe("-0.05");
  });
});

describe("formatINR", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(5_00_000_00n)).toBe("₹5,00,000.00");
    expect(formatINR(12_34_567_89n)).toBe("₹12,34,567.89");
    expect(formatINR(1_00_00_00_000_00n)).toBe("₹1,00,00,00,000.00");
  });

  it("formats small, negative and string inputs exactly", () => {
    expect(formatINR(5)).toBe("₹0.05");
    expect(formatINR("1999")).toBe("₹19.99");
    expect(formatINR(-150n)).toBe("-₹1.50");
  });

  it("supports hiding paise and the symbol", () => {
    expect(formatINR(12_34_567_89n, { showPaise: false })).toBe("₹12,34,567");
    expect(formatINR(12_34_567_89n, { symbol: false })).toBe("12,34,567.89");
  });
});

describe("formatINRCompact", () => {
  it("uses lakh and crore units", () => {
    expect(formatINRCompact(4_85_000_00n)).toBe("₹4.85 L");
    expect(formatINRCompact(1_20_00_000_00n)).toBe("₹1.20 Cr");
    expect(formatINRCompact(1_234_00_00_000_00n)).toBe("₹1,234.00 Cr");
  });

  it("rounds half up to two decimals of the unit", () => {
    expect(formatINRCompact(1_23_499_99n)).toBe("₹1.23 L");
    expect(formatINRCompact(1_23_500_00n)).toBe("₹1.24 L");
  });

  it("falls back to whole rupees below one lakh and keeps the sign", () => {
    expect(formatINRCompact(99_999_00n)).toBe("₹99,999");
    expect(formatINRCompact(0n)).toBe("₹0");
    expect(formatINRCompact(-4_85_000_00n)).toBe("-₹4.85 L");
  });
});

describe("basis points", () => {
  it.each([
    ["3", 300],
    ["2.5", 250],
    ["3.5%", 350],
    ["2.75", 275],
    ["0.01", 1],
    ["100", 10_000],
  ])("parses %s as %i bps", (input, expected) => {
    expect(parsePercentToBps(input)).toBe(expected);
  });

  it.each(["", "abc", "2.555", "1000", "-1", "3.5.1"])("rejects %j", (input) => {
    expect(parsePercentToBps(input)).toBeNull();
  });

  it("formats basis points without trailing zeros", () => {
    expect(formatBps(300)).toBe("3%");
    expect(formatBps(250)).toBe("2.5%");
    expect(formatBps(275)).toBe("2.75%");
    expect(formatBps(5)).toBe("0.05%");
    expect(formatBps(350, { suffix: false })).toBe("3.5");
  });

  it("renders basis points as a fixed two-decimal string", () => {
    expect(bpsToDecimalString(250)).toBe("2.50");
    expect(bpsToDecimalString(5)).toBe("0.05");
  });
});

describe("sumPaise", () => {
  it("treats missing values as zero", () => {
    expect(sumPaise([1_00n, null, undefined, 2_50n])).toBe(3_50n);
    expect(sumPaise([])).toBe(0n);
  });
});
