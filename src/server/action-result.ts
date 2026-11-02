import "server-only";
import { ZodError } from "zod";
import { DomainError } from "./errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Runs a server-action body and converts domain/validation failures into a serialisable result. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: zodFieldErrors(error) };
    }
    console.error("[action] unexpected failure", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
