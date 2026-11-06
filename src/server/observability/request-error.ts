import type { Instrumentation } from "next";
import { getRequestContext, runWithRequestContext } from "./context";
import { logger } from "./logger";
import { REQUEST_ID_HEADER } from "./request-id";

type Args = Parameters<Instrumentation.onRequestError>;

/** Structured log line for an error that escaped a render, route handler or server action. */
export function reportRequestError(error: Args[0], request: Args[1], context: Args[2]): void {
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = getRequestContext()?.requestId ?? (Array.isArray(header) ? header[0] : header);
  const log = () =>
    logger.error("request.unhandled_error", {
      err: error,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
      digest: (error as { digest?: unknown } | null)?.digest,
    });
  if (requestId && !getRequestContext()) runWithRequestContext({ requestId }, log);
  else log();
}
