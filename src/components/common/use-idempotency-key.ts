"use client";

import { useCallback, useRef } from "react";
import { newIdempotencyKey } from "@/lib/idempotency-key";

/**
 * One submission key per mounted control, created on first use. Retries of the same action reuse it,
 * so a resubmission after a lost response replays the original result instead of acting twice.
 */
export function useIdempotencyKey(): () => string {
  const ref = useRef<string | null>(null);
  return useCallback(() => (ref.current ??= newIdempotencyKey()), []);
}
