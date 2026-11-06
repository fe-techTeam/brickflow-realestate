/**
 * Provider selection for verification checks.
 *
 *   VERIFICATION_PROVIDER            sandbox | cashfree   GSTIN, PAN, bank account, Udyam
 *   VERIFICATION_EINVOICE_PROVIDER   sandbox | quicko     e-invoice (IRN); defaults to sandbox when the
 *                                                         primary provider is sandbox
 *
 * In production the provider must be named explicitly, and `sandbox` is refused unless
 * ALLOW_SANDBOX_VERIFICATION=true, in which case a warning is logged on every resolution.
 */
import { CashfreeVerificationProvider, CASHFREE_BASE_URLS } from "./providers/cashfree";
import { QuickoEInvoiceProvider, QUICKO_BASE_URLS } from "./providers/quicko";
import { SandboxVerificationProvider } from "./providers/sandbox";
import type { BankAccountVerifier, EInvoiceVerifier, GstinVerifier, PanVerifier, UdyamVerifier } from "./types";

export const PRIMARY_PROVIDERS = ["sandbox", "cashfree"] as const;
export const EINVOICE_PROVIDERS = ["sandbox", "quicko"] as const;
export type PrimaryProviderKey = (typeof PRIMARY_PROVIDERS)[number];
export type EInvoiceProviderKey = (typeof EINVOICE_PROVIDERS)[number];

export class VerificationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationConfigError";
  }
}

type Env = Record<string, string | undefined>;

export interface VerificationSelection {
  primary: PrimaryProviderKey;
  eInvoice: EInvoiceProviderKey | null;
  sandboxInProduction: boolean;
}

function required(env: Env, name: string, purpose: string): string {
  const value = env[name]?.trim();
  if (!value) throw new VerificationConfigError(`${name} is not set; it is required for ${purpose}.`);
  return value;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new VerificationConfigError(`${name} must be one of: ${allowed.join(", ")} (got "${value}").`);
  return value as T;
}

/** Validates the provider environment. Pure apart from reading `env`; throws VerificationConfigError. */
export function selectVerificationProviders(env: Env = process.env): VerificationSelection {
  const production = env.NODE_ENV === "production";
  const primaryRaw = env.VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (!primaryRaw && production) {
    throw new VerificationConfigError("VERIFICATION_PROVIDER is not set. Set it to a live provider (cashfree), or to sandbox together with ALLOW_SANDBOX_VERIFICATION=true.");
  }
  const primary = oneOf(primaryRaw || "sandbox", PRIMARY_PROVIDERS, "VERIFICATION_PROVIDER");
  const eInvoiceRaw = env.VERIFICATION_EINVOICE_PROVIDER?.trim().toLowerCase();
  const eInvoice = eInvoiceRaw ? oneOf(eInvoiceRaw, EINVOICE_PROVIDERS, "VERIFICATION_EINVOICE_PROVIDER") : primary === "sandbox" ? "sandbox" : null;

  const usesSandbox = primary === "sandbox" || eInvoice === "sandbox";
  if (production && usesSandbox && env.ALLOW_SANDBOX_VERIFICATION !== "true") {
    throw new VerificationConfigError(
      "The sandbox verification provider is refused in production. Configure a live provider, or set ALLOW_SANDBOX_VERIFICATION=true for a non-customer environment.",
    );
  }

  if (primary === "cashfree") {
    required(env, "CASHFREE_VERIFICATION_CLIENT_ID", "the Cashfree verification provider");
    required(env, "CASHFREE_VERIFICATION_CLIENT_SECRET", "the Cashfree verification provider");
    if (env.CASHFREE_VERIFICATION_ENV) oneOf(env.CASHFREE_VERIFICATION_ENV, Object.keys(CASHFREE_BASE_URLS) as (keyof typeof CASHFREE_BASE_URLS)[], "CASHFREE_VERIFICATION_ENV");
  }
  if (eInvoice === "quicko") {
    for (const name of ["QUICKO_API_KEY", "QUICKO_API_SECRET", "QUICKO_EINVOICE_GSTIN", "QUICKO_EINVOICE_USERNAME", "QUICKO_EINVOICE_PASSWORD"]) {
      required(env, name, "e-invoice verification through Sandbox.co.in");
    }
    if (env.QUICKO_ENV) oneOf(env.QUICKO_ENV, Object.keys(QUICKO_BASE_URLS) as (keyof typeof QUICKO_BASE_URLS)[], "QUICKO_ENV");
  }
  return { primary, eInvoice, sandboxInProduction: production && usesSandbox };
}

function pem(value: string | undefined): string | undefined {
  return value?.trim() ? value.replace(/\\n/g, "\n") : undefined;
}

let resolved: { signature: string; selection: VerificationSelection; primary: GstinVerifier & PanVerifier & BankAccountVerifier & UdyamVerifier; eInvoice: EInvoiceVerifier | null } | null = null;
let overrides: Partial<{ gstin: GstinVerifier; pan: PanVerifier; bankAccount: BankAccountVerifier; udyam: UdyamVerifier; eInvoice: EInvoiceVerifier }> = {};

const SIGNATURE_KEYS = [
  "NODE_ENV",
  "VERIFICATION_PROVIDER",
  "VERIFICATION_EINVOICE_PROVIDER",
  "ALLOW_SANDBOX_VERIFICATION",
  "CASHFREE_VERIFICATION_CLIENT_ID",
  "CASHFREE_VERIFICATION_CLIENT_SECRET",
  "CASHFREE_VERIFICATION_ENV",
  "CASHFREE_VERIFICATION_BASE_URL",
  "CASHFREE_VERIFICATION_PUBLIC_KEY",
  "QUICKO_API_KEY",
  "QUICKO_API_SECRET",
  "QUICKO_ENV",
  "QUICKO_BASE_URL",
  "QUICKO_EINVOICE_GSTIN",
  "QUICKO_EINVOICE_USERNAME",
  "QUICKO_EINVOICE_PASSWORD",
];

function resolve() {
  const env = process.env;
  const signature = SIGNATURE_KEYS.map((key) => env[key] ?? "").join("\u0000");
  if (resolved?.signature === signature) {
    if (resolved.selection.sandboxInProduction) warnSandbox();
    return resolved;
  }
  const selection = selectVerificationProviders(env);
  if (selection.sandboxInProduction) warnSandbox();
  const sandbox = new SandboxVerificationProvider();
  const production = env.NODE_ENV === "production";

  const primary =
    selection.primary === "cashfree"
      ? new CashfreeVerificationProvider({
          clientId: env.CASHFREE_VERIFICATION_CLIENT_ID!.trim(),
          clientSecret: env.CASHFREE_VERIFICATION_CLIENT_SECRET!.trim(),
          environment: (env.CASHFREE_VERIFICATION_ENV as keyof typeof CASHFREE_BASE_URLS) ?? (production ? "production" : "sandbox"),
          baseUrl: env.CASHFREE_VERIFICATION_BASE_URL?.trim() || undefined,
          publicKeyPem: pem(env.CASHFREE_VERIFICATION_PUBLIC_KEY),
        })
      : sandbox;

  const eInvoice =
    selection.eInvoice === "quicko"
      ? new QuickoEInvoiceProvider({
          apiKey: env.QUICKO_API_KEY!.trim(),
          apiSecret: env.QUICKO_API_SECRET!.trim(),
          environment: (env.QUICKO_ENV as keyof typeof QUICKO_BASE_URLS) ?? (production ? "production" : "test"),
          baseUrl: env.QUICKO_BASE_URL?.trim() || undefined,
          taxpayerGstin: env.QUICKO_EINVOICE_GSTIN!.trim(),
          taxpayerUsername: env.QUICKO_EINVOICE_USERNAME!.trim(),
          taxpayerPassword: env.QUICKO_EINVOICE_PASSWORD!,
        })
      : selection.eInvoice === "sandbox"
        ? sandbox
        : null;

  resolved = { signature, selection, primary, eInvoice };
  return resolved;
}

function warnSandbox() {
  console.warn(
    JSON.stringify({
      level: "warn",
      component: "connector",
      msg: "SANDBOX VERIFICATION PROVIDER ACTIVE IN PRODUCTION: identity, tax and bank checks return simulated results. Never use this with real customers.",
    }),
  );
}

/** Provider registry. Each accessor resolves (and validates) configuration on use. */
export const verification = {
  gstin: (): GstinVerifier => overrides.gstin ?? resolve().primary,
  pan: (): PanVerifier => overrides.pan ?? resolve().primary,
  bankAccount: (): BankAccountVerifier => overrides.bankAccount ?? resolve().primary,
  udyam: (): UdyamVerifier => overrides.udyam ?? resolve().primary,
  eInvoice: (): EInvoiceVerifier => {
    if (overrides.eInvoice) return overrides.eInvoice;
    const provider = resolve().eInvoice;
    if (!provider) throw new VerificationConfigError("No e-invoice verification provider is configured. Set VERIFICATION_EINVOICE_PROVIDER=quicko with its credentials.");
    return provider;
  },
  selection: (): VerificationSelection => resolve().selection,
};

/** Replaces providers in tests. Pass {} to restore environment-based selection. */
export function setVerificationProvidersForTesting(next: typeof overrides): void {
  overrides = next;
  resolved = null;
}
