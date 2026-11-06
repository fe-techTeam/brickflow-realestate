/**
 * Business-name similarity used when a provider does not return its own match score.
 *
 * Names are normalised (case, punctuation, legal-form suffixes, honorifics) and compared two ways:
 * token alignment (exact tokens, initials and near-identical spellings) and character-bigram Dice
 * similarity of the joined name. The higher of the two is the score (0–100).
 */

export type NameMatchBand = "EXACT" | "STRONG" | "PARTIAL" | "WEAK" | "NONE";

export interface NameMatch {
  score: number;
  band: NameMatchBand;
  source: "provider" | "local";
  comparedWith?: string;
}

const STOP_TOKENS = new Set(["M/S", "MS", "MESSRS", "THE", "AND", "OF", "SHRI", "SMT", "MR", "MRS", "DR"]);

// Legal-form words carry no identity; multi-word forms are collapsed first.
const LEGAL_FORMS: [RegExp, string][] = [
  [/\bPRIVATE LIMITED\b/g, " "],
  [/\bPVT\.? ?LTD\.?\b/g, " "],
  [/\bP\.? ?LTD\.?\b/g, " "],
  [/\bLIMITED LIABILITY PARTNERSHIP\b/g, " "],
  [/\bLIMITED\b/g, " "],
  [/\bLTD\.?\b/g, " "],
  [/\bL\.?L\.?P\.?\b/g, " "],
  [/\bPVT\.?\b/g, " "],
  [/\bPRIVATE\b/g, " "],
  [/\bCO\.?\b/g, " "],
  [/\bCORP(ORATION)?\b/g, " "],
  [/\bINC\.?\b/g, " "],
  [/\bOPC\b/g, " "],
];

export function normaliseName(name: string): string[] {
  let value = name.toUpperCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " AND ");
  for (const [pattern, replacement] of LEGAL_FORMS) value = value.replace(pattern, replacement);
  return value
    .replace(/[^A-Z0-9/ ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_TOKENS.has(token));
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 0.75;
  const similarity = dice(a, b);
  return similarity >= 0.8 ? similarity : 0;
}

function tokenAlignmentScore(left: string[], right: string[]): number {
  const used = new Set<number>();
  let matched = 0;
  for (const token of left) {
    let best = 0;
    let bestIndex = -1;
    right.forEach((candidate, index) => {
      if (used.has(index)) return;
      const similarity = tokenSimilarity(token, candidate);
      if (similarity > best) {
        best = similarity;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched += best;
    }
  }
  return (2 * matched) / (left.length + right.length);
}

export function nameMatchBand(score: number): NameMatchBand {
  if (score >= 100) return "EXACT";
  if (score >= 85) return "STRONG";
  if (score >= 65) return "PARTIAL";
  if (score >= 40) return "WEAK";
  return "NONE";
}

export function scoreNames(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (left.length === 0 || right.length === 0) return 0;
  const aligned = tokenAlignmentScore(left, right);
  const joined = dice(left.join(""), right.join(""));
  return Math.round(Math.max(aligned, joined) * 100);
}

/** Best match of the registered name against any of the organisation's known names. */
export function matchNames(registered: string | null | undefined, candidates: (string | null | undefined)[]): NameMatch | null {
  if (!registered) return null;
  let best: NameMatch | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const score = scoreNames(registered, candidate);
    if (!best || score > best.score) best = { score, band: nameMatchBand(score), source: "local", comparedWith: candidate };
  }
  return best;
}
