import { describe, expect, it } from "vitest";
import { amountInWordsINR, numberToIndianWords } from "./amount-words";

describe("numberToIndianWords", () => {
  it.each([
    [0n, "Zero"],
    [7n, "Seven"],
    [19n, "Nineteen"],
    [20n, "Twenty"],
    [45n, "Forty Five"],
    [100n, "One Hundred"],
    [110n, "One Hundred Ten"],
    [1_000n, "One Thousand"],
    [99_999n, "Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [5_00_000n, "Five Lakh"],
    [4_85_000n, "Four Lakh Eighty Five Thousand"],
    [1_23_45_678n, "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight"],
    [100_00_00_000n, "One Hundred Crore"],
  ])("spells %s", (value, words) => {
    expect(numberToIndianWords(value)).toBe(words);
  });
});

describe("amountInWordsINR", () => {
  it("spells whole rupees", () => {
    expect(amountInWordsINR(5_00_000_00n)).toBe("Indian Rupees Five Lakh Only");
    expect(amountInWordsINR(4_85_000_00n)).toBe("Indian Rupees Four Lakh Eighty Five Thousand Only");
  });

  it("includes paise when present", () => {
    expect(amountInWordsINR(5_00_000_50n)).toBe("Indian Rupees Five Lakh and Fifty Paise Only");
    expect(amountInWordsINR(1n)).toBe("Indian Rupees Zero and One Paise Only");
  });
});
