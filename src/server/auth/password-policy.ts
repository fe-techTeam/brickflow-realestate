import "server-only";

export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt only uses the first 72 bytes; longer passwords would be silently truncated. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * Words that dominate breached-password lists. A password is rejected when, after removing digits,
 * symbols and common character substitutions, nothing but one of these words (or repeats of it) remains.
 */
const COMMON_WORDS = [
  "password", "passw0rd", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbnm", "letmein", "welcome", "admin",
  "administrator", "iloveyou", "monkey", "dragon", "master", "sunshine", "princess", "football", "baseball", "cricket",
  "shadow", "superman", "batman", "trustno", "whatever", "freedom", "starwars", "secret", "login", "changeme",
  "default", "abc", "abcdef", "abcdefgh", "test", "testing", "user", "guest", "root", "india", "bharat", "mumbai",
  "delhi", "bangalore", "bengaluru", "pune", "hyderabad", "chennai", "kolkata", "brickflow", "veefin", "builder",
  "partner", "finance", "accounts", "realestate", "property", "company", "office", "summer", "winter", "spring",
  "autumn", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "monday", "friday", "hello", "love", "lovely", "computer", "internet", "samsung", "google",
  "apple", "microsoft", "jesus", "krishna", "ganesh", "omsairam", "jaishreeram", "mother", "father",
];

/** Frequently breached passwords of at least the minimum length, compared case-insensitively. */
const COMMON_PASSWORDS = [
  "123456789012", "1234567890123", "12345678901234", "1234567890qwerty", "qwertyuiop123", "qwerty123456",
  "qwertyuiopasdf", "1q2w3e4r5t6y", "1q2w3e4r5t6y7u", "q1w2e3r4t5y6", "zaq12wsxcde3", "1qaz2wsx3edc",
  "1qazxsw23edc", "qazwsxedcrfv", "asdfghjkl123", "abcdefghijkl", "abcd12345678", "abc123456789",
  "iloveyou1234", "password1234", "password12345", "password123456", "passwordpassword", "welcome12345",
  "letmein12345", "aaaaaaaaaaaa", "111111111111", "000000000000", "123123123123", "987654321098",
  "123456123456", "112233445566", "abcabcabcabc", "qweasdzxc123", "qwerty12345678", "!@#$%^&*()_+",
  "1234567890-=", "098765432112",
];

const SUBSTITUTIONS: Record<string, string> = { "@": "a", "4": "a", "8": "b", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t", "+": "t" };

/** Letter-only forms of the password: with look-alike substitutions undone, and with all non-letters dropped. */
function letterCores(password: string): string[] {
  const lower = password.toLowerCase();
  const substituted = [...lower].map((c) => SUBSTITUTIONS[c] ?? c).join("").replace(/[^a-z]/g, "");
  return [...new Set([substituted, lower.replace(/[^a-z]/g, "")])];
}

function isRepetitionOf(value: string, words: readonly string[]): boolean {
  if (value.length === 0) return false;
  return words.some((word) => word.length > 0 && value.length % word.length === 0 && word.repeat(value.length / word.length) === value);
}

function isSequenceOrRepeat(password: string): boolean {
  if (/^(.)\1+$/.test(password)) return true;
  const codes = [...password].map((c) => c.charCodeAt(0));
  const step = codes[1]! - codes[0]!;
  return Math.abs(step) === 1 && codes.every((code, i) => i === 0 || code - codes[i - 1]! === step);
}

export interface PasswordPolicyContext {
  email?: string;
  name?: string;
}

/** Returns the reasons the password is not acceptable; an empty array means it passes. */
export function passwordPolicyViolations(password: string, context: PasswordPolicyContext = {}): string[] {
  const problems: string[] = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) problems.push(`Use at most ${PASSWORD_MAX_BYTES} characters.`);
  if (password.trim() !== password) problems.push("Do not start or end the password with a space.");
  if (problems.length) return problems;

  const lower = password.toLowerCase();
  const cores = letterCores(password);
  const personal = [context.email?.split("@")[0], ...(context.name?.split(/\s+/) ?? [])]
    .map((part) => part?.toLowerCase().replace(/[^a-z]/g, "") ?? "")
    .filter((part) => part.length >= 3);

  if (
    COMMON_PASSWORDS.includes(lower) ||
    isSequenceOrRepeat(password) ||
    cores.some((core) => isRepetitionOf(core, COMMON_WORDS)) ||
    cores.some((core) => COMMON_WORDS.some((word) => word.length >= 4 && core.length - word.length <= 2 && core.includes(word)))
  ) {
    problems.push("This password is too common. Choose a less predictable one, for example a phrase of several unrelated words.");
  } else if (cores.some((core) => personal.some((part) => core.includes(part) && core.length - part.length <= 3))) {
    problems.push("Do not base the password on your name or email address.");
  }
  return problems;
}
