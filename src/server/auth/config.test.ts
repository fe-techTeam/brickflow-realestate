import { afterEach, describe, expect, it, vi } from "vitest";
import { MFA_REQUIRED_ROLES, mfaEnforced, mfaRequiredForRole, parseBooleanEnv } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MFA_ENFORCED", () => {
  it("defaults to on in production and off in development and test", () => {
    vi.stubEnv("MFA_ENFORCED", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(mfaEnforced()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(mfaEnforced()).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(mfaEnforced()).toBe(false);
  });

  it("can be set explicitly, and warns loudly when turned off in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MFA_ENFORCED", "true");
    expect(mfaEnforced()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MFA_ENFORCED", "false");
    expect(mfaEnforced()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MFA_ENFORCED=false in production"));
    warn.mockRestore();
  });

  it("applies only to builder accounts, finance operations and super admins", () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(["BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"]);
    expect(mfaRequiredForRole("SUPER_ADMIN")).toBe(true);
    expect(mfaRequiredForRole("FINANCE_OPS")).toBe(true);
    expect(mfaRequiredForRole("BUILDER_ACCOUNTS")).toBe(true);
    expect(mfaRequiredForRole("CP_ADMIN")).toBe(false);
    vi.stubEnv("MFA_ENFORCED", "false");
    expect(mfaRequiredForRole("SUPER_ADMIN")).toBe(false);
  });

  it("rejects values that are not clearly true or false", () => {
    expect(parseBooleanEnv("X", "yes", false)).toBe(true);
    expect(parseBooleanEnv("X", "0", true)).toBe(false);
    expect(() => parseBooleanEnv("X", "enabled", false)).toThrow(/X must be "true" or "false"/);
  });
});
