/** Typed failures raised by external-provider connectors. Callers branch on `kind`, never on provider codes. */

export type ConnectorErrorKind = "PROVIDER_DOWN" | "INVALID_INPUT" | "NOT_FOUND" | "RATE_LIMITED" | "AUTH_FAILURE";

export interface ConnectorErrorDetails {
  provider: string;
  operation: string;
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

export class ConnectorError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    details: ConnectorErrorDetails,
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ConnectorError";
    this.provider = details.provider;
    this.operation = details.operation;
    this.httpStatus = details.httpStatus;
    this.providerCode = details.providerCode;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
  }

  /** Transient failures worth retrying later (not the same as being safe to retry immediately). */
  get transient(): boolean {
    return this.kind === "PROVIDER_DOWN" || this.kind === "RATE_LIMITED";
  }
}

export class ProviderDownError extends ConnectorError {
  constructor(message: string, details: ConnectorErrorDetails) {
    super("PROVIDER_DOWN", message, details);
    this.name = "ProviderDownError";
  }
}

export class InvalidInputError extends ConnectorError {
  constructor(message: string, details: ConnectorErrorDetails) {
    super("INVALID_INPUT", message, details);
    this.name = "InvalidInputError";
  }
}

export class NotFoundError extends ConnectorError {
  constructor(message: string, details: ConnectorErrorDetails) {
    super("NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class RateLimitedError extends ConnectorError {
  constructor(message: string, details: ConnectorErrorDetails) {
    super("RATE_LIMITED", message, details);
    this.name = "RateLimitedError";
  }
}

export class AuthFailureError extends ConnectorError {
  constructor(message: string, details: ConnectorErrorDetails) {
    super("AUTH_FAILURE", message, details);
    this.name = "AuthFailureError";
  }
}

export function connectorError(kind: ConnectorErrorKind, message: string, details: ConnectorErrorDetails): ConnectorError {
  switch (kind) {
    case "PROVIDER_DOWN":
      return new ProviderDownError(message, details);
    case "INVALID_INPUT":
      return new InvalidInputError(message, details);
    case "NOT_FOUND":
      return new NotFoundError(message, details);
    case "RATE_LIMITED":
      return new RateLimitedError(message, details);
    case "AUTH_FAILURE":
      return new AuthFailureError(message, details);
  }
}

/** Default mapping from an HTTP status to an error kind; adapters refine it with provider codes. */
export function kindForHttpStatus(status: number): ConnectorErrorKind {
  if (status === 401 || status === 403) return "AUTH_FAILURE";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 409 || status === 422) return "INVALID_INPUT";
  return "PROVIDER_DOWN";
}

export function isConnectorError(error: unknown): error is ConnectorError {
  return error instanceof ConnectorError;
}
