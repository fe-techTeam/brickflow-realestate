export type DomainErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "RATE_LIMITED" | "STEP_UP_REQUIRED";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const unauthenticated = (message = "Please sign in to continue.") => new DomainError("UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to perform this action.") => new DomainError("FORBIDDEN", message);
export const notFound = (message = "The requested record was not found.") => new DomainError("NOT_FOUND", message);
export const conflict = (message: string) => new DomainError("CONFLICT", message);
export const invalid = (message: string, fieldErrors?: Record<string, string[]>) =>
  new DomainError("VALIDATION", message, fieldErrors);
