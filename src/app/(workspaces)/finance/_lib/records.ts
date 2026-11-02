import "server-only";
import { notFound } from "next/navigation";
import { DomainError } from "@/server/errors";

/** Resolves a scoped read, rendering the segment's not-found UI when the record is missing or outside the actor's scope. */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
