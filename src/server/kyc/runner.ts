import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, VerificationCheckStatus, VerificationCheckType, VerificationSubject } from "@/generated/prisma/client";
import { maskPan } from "@/lib/verification/masking";
import { isConnectorError, type ConnectorError } from "../connectors/errors";
import { redact } from "../connectors/redaction";
import { VerificationConfigError } from "../connectors/verification/registry";
import type { CallContext, ProviderOutcome } from "../connectors/verification/types";
import { fingerprintField } from "../crypto/field-encryption";
import { db, type Tx } from "../db";
import { conflict } from "../errors";
import { kycPolicy } from "./config";
import type { Evaluation } from "./evaluate";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Statuses produced by a real provider answer, and therefore safe to reuse from the cache. */
const CACHEABLE: VerificationCheckStatus[] = ["VERIFIED", "REVIEW_REQUIRED", "FAILED"];

export type ProviderCheckType = Exclude<VerificationCheckType, "RERA_AGENT">;

export interface ProviderCheckRequest<T> {
  organisationId: string;
  type: ProviderCheckType;
  subject?: VerificationSubject;
  subjectRef?: string | null;
  bankAccountId?: string | null;
  /** Canonical input, including anything sent to the provider that changes its answer (e.g. the name). */
  cacheKey: string;
  inputMasked: string;
  provider: string;
  requestedById: string | null;
  requestId?: string;
  now?: Date;
  call: (context: CallContext) => Promise<ProviderOutcome<T>>;
  evaluate: (result: T) => Evaluation;
}

/** A check outcome ready to be written inside the caller's transaction. */
export interface PreparedCheck {
  data: Prisma.VerificationCheckUncheckedCreateInput;
  status: VerificationCheckStatus;
  reasons: string[];
  result: unknown;
  fromCache: boolean;
}

/** The normalised result as stored: PAN is the only full identifier in a result, so it is masked. */
function storableResult(type: ProviderCheckType, result: unknown): Prisma.InputJsonValue {
  const copy = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  if (type === "PAN" && typeof copy.pan === "string") copy.pan = maskPan(copy.pan);
  return copy as Prisma.InputJsonValue;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function inputFingerprint(type: VerificationCheckType, cacheKey: string): string {
  return fingerprintField(`${type}|${cacheKey}`, "verification-input");
}

const UNAVAILABLE_MESSAGE: Record<ConnectorError["kind"], string> = {
  PROVIDER_DOWN: "The verification source is temporarily unavailable. Please try again in a few minutes.",
  RATE_LIMITED: "Too many verification requests right now. Please try again in a minute.",
  AUTH_FAILURE: "Verification is not available at the moment. Our team has been alerted.",
  INVALID_INPUT: "The details could not be verified.",
  NOT_FOUND: "No matching record was found.",
};

/**
 * Runs a provider check outside any database transaction (never hold a transaction across an HTTP
 * call), reusing a recent identical result when one exists.
 *
 * - A definitive answer (valid, invalid, not found, rejected input) returns a PreparedCheck that the
 *   caller persists together with its side effects.
 * - A provider failure is persisted immediately as an ERROR check for operations, and surfaces to
 *   the user as a CONFLICT DomainError with a retry message.
 */
export async function runProviderCheck<T>(request: ProviderCheckRequest<T>): Promise<PreparedCheck> {
  const now = request.now ?? new Date();
  const policy = kycPolicy();
  const fingerprint = inputFingerprint(request.type, request.cacheKey);
  const validityMs = policy.validityDays[request.type] * DAY_MS;
  const base = {
    organisationId: request.organisationId,
    bankAccountId: request.bankAccountId ?? null,
    type: request.type,
    subject: request.subject ?? "ORGANISATION",
    subjectRef: request.subjectRef ?? null,
    inputFingerprint: fingerprint,
    inputMasked: request.inputMasked,
    requestId: request.requestId ?? null,
    requestedById: request.requestedById,
    checkedAt: now,
  } satisfies Partial<Prisma.VerificationCheckUncheckedCreateInput>;

  if (policy.cacheTtlHours > 0) {
    const cached = await db.verificationCheck.findFirst({
      where: {
        organisationId: request.organisationId,
        type: request.type,
        provider: request.provider,
        inputFingerprint: fingerprint,
        status: { in: CACHEABLE },
        checkedAt: { gte: new Date(now.getTime() - policy.cacheTtlHours * HOUR_MS) },
      },
      orderBy: { checkedAt: "desc" },
    });
    if (cached && !cached.result && (cached.errorKind === "NOT_FOUND" || cached.errorKind === "INVALID_INPUT")) {
      return {
        status: "FAILED",
        reasons: cached.reasons,
        result: null,
        fromCache: true,
        data: { ...base, provider: cached.provider, status: "FAILED", reasons: cached.reasons, errorKind: cached.errorKind, errorCode: cached.errorCode, cachedFromId: cached.cachedFromId ?? cached.id },
      };
    }
    if (cached?.result) {
      const result = cached.result as T;
      const evaluation = request.evaluate(result);
      return {
        status: evaluation.status,
        reasons: evaluation.reasons,
        result,
        fromCache: true,
        data: {
          ...base,
          provider: cached.provider,
          providerReference: cached.providerReference,
          status: evaluation.status,
          result: cached.result as Prisma.InputJsonValue,
          nameMatchScore: evaluation.nameMatch?.score ?? null,
          reasons: evaluation.reasons,
          rawResponseHash: cached.rawResponseHash,
          rawResponseRedacted: (cached.rawResponseRedacted ?? undefined) as Prisma.InputJsonValue | undefined,
          cachedFromId: cached.cachedFromId ?? cached.id,
          expiresAt: new Date(cached.checkedAt.getTime() + validityMs),
        },
      };
    }
  }

  try {
    const outcome = await request.call({ requestId: request.requestId });
    const evaluation = request.evaluate(outcome.result);
    return {
      status: evaluation.status,
      reasons: evaluation.reasons,
      result: outcome.result,
      fromCache: false,
      data: {
        ...base,
        provider: outcome.provider,
        providerReference: outcome.providerReference,
        status: evaluation.status,
        result: storableResult(request.type, outcome.result),
        nameMatchScore: evaluation.nameMatch?.score ?? null,
        reasons: evaluation.reasons,
        rawResponseHash: sha256Hex(outcome.rawBody),
        rawResponseRedacted: outcome.rawJson === undefined ? undefined : (redact(outcome.rawJson) as Prisma.InputJsonValue),
        expiresAt: new Date(now.getTime() + validityMs),
      },
    };
  } catch (error) {
    if (isConnectorError(error) && (error.kind === "NOT_FOUND" || error.kind === "INVALID_INPUT")) {
      const reason = error.message;
      return {
        status: "FAILED",
        reasons: [reason],
        result: null,
        fromCache: false,
        data: {
          ...base,
          provider: error.provider,
          status: "FAILED",
          reasons: [reason],
          errorKind: error.kind,
          errorCode: error.providerCode ?? null,
        },
      };
    }
    if (isConnectorError(error)) {
      await db.verificationCheck.create({
        data: { ...base, provider: error.provider, status: "ERROR", reasons: [error.message], errorKind: error.kind, errorCode: error.providerCode ?? null },
      });
      throw conflict(UNAVAILABLE_MESSAGE[error.kind]);
    }
    if (error instanceof VerificationConfigError) {
      console.error(JSON.stringify({ level: "error", component: "kyc", msg: "verification provider misconfigured", error: error.message }));
      throw conflict(UNAVAILABLE_MESSAGE.AUTH_FAILURE);
    }
    throw error;
  }
}

/** Persists a prepared check inside the caller's transaction. */
export async function persistCheck(tx: Tx, prepared: PreparedCheck) {
  return tx.verificationCheck.create({ data: prepared.data });
}
