import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, passwordPolicyViolations } from "./password-policy";

const ctx = { email: "priya.sharma@prestige-demo.test", name: "Priya Sharma" };

describe("password policy", () => {
  it.each(["correct horse battery staple", "Tamarind-Ledger-Monsoon-42", "q8#Lw2!vZr9@Kp", "mango orbit violin canal"])("accepts a strong password: %s", (password) => {
    expect(passwordPolicyViolations(password, ctx)).toEqual([]);
  });

  it("enforces the minimum length, counting characters not bytes", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordPolicyViolations("Short!Pass1")[0]).toMatch(/at least 12/);
    expect(passwordPolicyViolations("नमस्ते-दुनिया-आज")).toEqual([]);
  });

  it("rejects passwords longer than bcrypt can use", () => {
    expect(passwordPolicyViolations("x".repeat(40) + "y".repeat(33))[0]).toMatch(/at most 72/);
  });

  it("rejects leading or trailing spaces", () => {
    expect(passwordPolicyViolations(" tamarind ledger monsoon")[0]).toMatch(/space/);
  });

  it.each([
    "password1234",
    "Password2024!",
    "P@ssw0rd2026",
    "qwerty123456",
    "qwertyuiop12",
    "123456789012",
    "aaaaaaaaaaaa",
    "abcdefghijklmnop",
    "BrickFlow@2026",
    "Welcome@12345",
    "iloveyou1234",
    "passwordpassword",
    "LetMeIn!2025",
    "1q2w3e4r5t6y",
    "!@#$%^&*()_+",
  ])("rejects the common password %s", (password) => {
    expect(passwordPolicyViolations(password, ctx)[0]).toMatch(/too common/);
  });

  it("rejects passwords based on the user's name or email", () => {
    expect(passwordPolicyViolations("PriyaSharma2026", ctx)[0]).toMatch(/name or email/);
    expect(passwordPolicyViolations("priya.sharma!!", ctx)[0]).toMatch(/name or email/);
    expect(passwordPolicyViolations("Sharma@123456", ctx)[0]).toMatch(/name or email/);
  });
});
