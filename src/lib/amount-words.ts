const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Indian-system words for a whole number (crore / lakh / thousand). */
export function numberToIndianWords(value: bigint): string {
  if (value === 0n) return "Zero";
  const parts: string[] = [];
  let n = value;
  const crore = n / 1_00_00_000n;
  n %= 1_00_00_000n;
  if (crore > 0n) parts.push(`${numberToIndianWords(crore)} Crore`);
  const lakh = Number(n / 1_00_000n);
  n %= 1_00_000n;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Number(n / 1_000n);
  n %= 1_000n;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n > 0n) parts.push(belowThousand(Number(n)));
  return parts.join(" ");
}

/** "Indian Rupees Five Lakh Only" / "... and Fifty Paise Only". */
export function amountInWordsINR(paise: bigint): string {
  const rupees = paise / 100n;
  const p = Number(paise % 100n);
  return `Indian Rupees ${numberToIndianWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
}
