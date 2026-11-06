import { createHash } from "node:crypto";
import { matchNames } from "@/lib/verification/name-match";
import { gstStateName, panHolderType, validateAccountNumber, validateGstin, validateIfsc, validateIrn, validatePan, validateUdyam } from "@/lib/verification/validation";
import { InvalidInputError, NotFoundError, ProviderDownError } from "../../errors";
import type {
  BankAccountInput,
  BankAccountResult,
  BankAccountVerifier,
  CallContext,
  EInvoiceInput,
  EInvoiceResult,
  EInvoiceVerifier,
  GstinInput,
  GstinResult,
  GstinVerifier,
  PanInput,
  PanResult,
  PanVerifier,
  ProviderOutcome,
  UdyamInput,
  UdyamResult,
  UdyamVerifier,
} from "../types";

export const SANDBOX_PROVIDER = "sandbox";

/**
 * Deterministic, offline provider for development, tests and demonstrations. Results depend only on
 * the input, so flows are reproducible. Trigger values (see docs/INTEGRATIONS.md):
 *
 *   digits 0000 → not found / invalid     digits 9999 → cancelled / blocked
 *   digits 1111 → registered under a different name (routes to review)
 *   digits 5555 → provider unavailable
 *
 * "Digits" are the PAN's four digits (also inside a GSTIN), the last four digits of a bank account
 * or Udyam number, and the first four characters of an IRN (0000 / ffff / 5555).
 */
export const UNRELATED_NAME = "SANDBOX UNRELATED TRADERS PRIVATE LIMITED";

function digest(value: string): string {
  return createHash("sha256").update(`sandbox:${value}`).digest("hex");
}

function numberFrom(value: string, modulo: number): number {
  return Number.parseInt(digest(value).slice(0, 8), 16) % modulo;
}

function isoDayAfter(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function outcome<T>(operation: string, key: string, result: T, raw: Record<string, unknown>): ProviderOutcome<T> {
  const body = { provider: SANDBOX_PROVIDER, operation, ...raw };
  return { result, provider: SANDBOX_PROVIDER, providerReference: `SBX-${digest(`${operation}:${key}`).slice(0, 12).toUpperCase()}`, rawBody: JSON.stringify(body), rawJson: body };
}

function details(operation: string, context?: CallContext) {
  return { provider: SANDBOX_PROVIDER, operation, requestId: context?.requestId };
}

function unavailable(operation: string, context?: CallContext): never {
  throw new ProviderDownError("The verification source is temporarily unavailable. Try again shortly.", details(operation, context));
}

function nameFor(trigger: string, provided: string | undefined, fallback: string): string {
  if (trigger === "1111") return UNRELATED_NAME;
  return (provided?.trim() || fallback).toUpperCase();
}

export class SandboxVerificationProvider implements GstinVerifier, PanVerifier, BankAccountVerifier, UdyamVerifier, EInvoiceVerifier {
  readonly provider = SANDBOX_PROVIDER;

  async verifyGstin(input: GstinInput, context?: CallContext): Promise<ProviderOutcome<GstinResult>> {
    const operation = "gstin.verify";
    const valid = validateGstin(input.gstin);
    if (!valid.ok) throw new InvalidInputError(valid.error, details(operation, context));
    const gstin = valid.value;
    const trigger = gstin.slice(7, 11);
    if (trigger === "5555") unavailable(operation, context);
    if (trigger === "0000") throw new NotFoundError("No GST registration exists for this GSTIN.", details(operation, context));
    const legalName = nameFor(trigger, input.name, `SANDBOX ENTERPRISE ${gstin.slice(2, 12)}`);
    const cancelled = trigger === "9999";
    const result: GstinResult = {
      gstin,
      status: cancelled ? "CANCELLED" : "ACTIVE",
      providerStatus: cancelled ? "Cancelled" : "Active",
      legalName,
      tradeName: legalName,
      stateCode: gstin.slice(0, 2),
      stateName: gstStateName(gstin),
      registrationDate: isoDayAfter("2017-07-01", numberFrom(gstin, 2400)),
      constitution: panHolderType(gstin.slice(2, 12)),
      taxpayerType: "Regular",
      nameMatch: null,
    };
    return outcome(operation, gstin, result, { result });
  }

  async verifyPan(input: PanInput, context?: CallContext): Promise<ProviderOutcome<PanResult>> {
    const operation = "pan.verify";
    const valid = validatePan(input.pan);
    if (!valid.ok) throw new InvalidInputError(valid.error, details(operation, context));
    const pan = valid.value;
    const trigger = pan.slice(5, 9);
    if (trigger === "5555") unavailable(operation, context);
    const status: PanResult["status"] = trigger === "0000" ? "INVALID" : trigger === "9999" ? "DEACTIVATED" : "VALID";
    const registeredName = status === "INVALID" ? null : nameFor(trigger, input.name, `SANDBOX HOLDER ${pan}`);
    const match = input.name ? matchNames(registeredName, [input.name]) : null;
    const result: PanResult = {
      pan,
      status,
      holderType: panHolderType(pan),
      registeredName,
      nameMatch: match ? { ...match, source: "provider" } : null,
      aadhaarSeeded: status === "VALID" && pan[3] === "P" ? true : null,
    };
    return outcome(operation, pan, result, { result });
  }

  async verifyBankAccount(input: BankAccountInput, context?: CallContext): Promise<ProviderOutcome<BankAccountResult>> {
    const operation = "bank_account.verify";
    const account = validateAccountNumber(input.accountNumber);
    if (!account.ok) throw new InvalidInputError(account.error, details(operation, context));
    const ifsc = validateIfsc(input.ifsc);
    if (!ifsc.ok) throw new InvalidInputError(ifsc.error, details(operation, context));
    const trigger = account.value.slice(-4);
    if (trigger === "5555") unavailable(operation, context);
    const statusCode: BankAccountResult["statusCode"] = trigger === "0000" ? "INVALID_ACCOUNT" : trigger === "9999" ? "ACCOUNT_BLOCKED" : "ACCOUNT_VALID";
    const valid = statusCode === "ACCOUNT_VALID";
    const beneficiaryName = valid ? nameFor(trigger, input.name, "SANDBOX ACCOUNT HOLDER") : null;
    const match = valid && input.name ? matchNames(beneficiaryName, [input.name]) : null;
    const result: BankAccountResult = {
      accountLast4: trigger,
      ifsc: ifsc.value,
      status: valid ? "VALID" : "INVALID",
      statusCode,
      beneficiaryName,
      bankName: valid ? `${ifsc.value.slice(0, 4)} BANK` : null,
      branch: valid ? "SANDBOX BRANCH" : null,
      city: valid ? "MUMBAI" : null,
      nameMatch: match ? { ...match, source: "provider" } : null,
      utr: valid ? String(100000000000 + numberFrom(`${ifsc.value}:${account.value}`, 899999999999)) : null,
    };
    return outcome(operation, `${ifsc.value}:${account.value}`, result, { result });
  }

  async verifyUdyam(input: UdyamInput, context?: CallContext): Promise<ProviderOutcome<UdyamResult>> {
    const operation = "udyam.verify";
    const valid = validateUdyam(input.udyamNumber);
    if (!valid.ok) throw new InvalidInputError(valid.error, details(operation, context));
    const udyam = valid.value;
    const trigger = udyam.slice(-4);
    if (trigger === "5555") unavailable(operation, context);
    if (trigger === "0000") throw new NotFoundError("No Udyam registration exists for this number.", details(operation, context));
    const lastDigit = Number(udyam.slice(-1));
    const result: UdyamResult = {
      udyamNumber: udyam,
      status: trigger === "9999" ? "CANCELLED" : "ACTIVE",
      enterpriseName: nameFor(trigger, input.name, "SANDBOX ENTERPRISE"),
      enterpriseType: lastDigit <= 6 ? "MICRO" : lastDigit <= 8 ? "SMALL" : "MEDIUM",
      organisationType: "Partnership",
      majorActivity: "Services",
      registrationDate: isoDayAfter("2020-07-01", numberFrom(udyam, 1800)),
      classificationYear: "2025-26",
    };
    return outcome(operation, udyam, result, { result });
  }

  async verifyEInvoice(input: EInvoiceInput, context?: CallContext): Promise<ProviderOutcome<EInvoiceResult>> {
    const operation = "e_invoice.verify";
    const valid = validateIrn(input.irn);
    if (!valid.ok) throw new InvalidInputError(valid.error, details(operation, context));
    const irn = valid.value;
    const trigger = irn.slice(0, 4);
    if (trigger === "5555") unavailable(operation, context);
    if (trigger === "0000") throw new NotFoundError("Requested IRN data is not available.", details(operation, context));
    const result: EInvoiceResult = {
      irn,
      status: trigger === "ffff" ? "CANCELLED" : "ACTIVE",
      ackNumber: String(112000000000000 + numberFrom(irn, 999999999999)),
      ackDate: `${isoDayAfter("2026-01-01", numberFrom(irn, 300))}T11:00:00+05:30`,
      ewayBillNumber: null,
      sellerGstin: input.supplierGstin ?? null,
      buyerGstin: null,
      documentNumber: null,
      documentDate: null,
      totalValuePaise: null,
    };
    return outcome(operation, irn, result, { result });
  }
}
