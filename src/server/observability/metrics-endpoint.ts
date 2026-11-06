import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { renderBusinessMetrics } from "./business-metrics";
import { logger, serviceVersion } from "./logger";
import { registry, renderGauge } from "./metrics";
import { renderRuntimeMetrics } from "./runtime-metrics";

export const MIN_METRICS_TOKEN_LENGTH = 32;

export type MetricsAccess = "disabled" | "unauthorised" | "granted";

let warnedWeakToken = false;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * The endpoint exists only when METRICS_TOKEN is configured (otherwise it answers 404). A token shorter
 * than 32 characters is treated as misconfiguration and also disables the endpoint.
 */
export function metricsAccess(authorization: string | null, token: string | undefined = process.env.METRICS_TOKEN): MetricsAccess {
  const expected = token?.trim();
  if (!expected) return "disabled";
  if (expected.length < MIN_METRICS_TOKEN_LENGTH) {
    if (!warnedWeakToken) {
      warnedWeakToken = true;
      logger.error("metrics.token_too_short", { minimumLength: MIN_METRICS_TOKEN_LENGTH });
    }
    return "disabled";
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  if (!match) return "unauthorised";
  // Comparing fixed-length digests keeps the comparison constant-time regardless of input length.
  return timingSafeEqual(digest(match[1]!), digest(expected)) ? "granted" : "unauthorised";
}

export async function renderMetrics(now: Date = new Date()): Promise<string> {
  const started = performance.now();
  const blocks = [renderRuntimeMetrics({ service: process.env.SERVICE_NAME?.trim() || "brickflow-web", version: serviceVersion() }, now.getTime()), registry.render()];
  let businessUp = 1;
  try {
    blocks.push(await renderBusinessMetrics(now));
  } catch (error) {
    businessUp = 0;
    logger.error("metrics.business_query_failed", { err: error });
  }
  blocks.push(
    renderGauge("brickflow_business_metrics_up", "1 when the business gauges could be read from the database.", [{ value: businessUp }]),
    renderGauge("brickflow_metrics_scrape_duration_seconds", "Time taken to produce this scrape.", [{ value: (performance.now() - started) / 1000 }]),
  );
  return `${blocks.filter(Boolean).join("\n")}\n`;
}
