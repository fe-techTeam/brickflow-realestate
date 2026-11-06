import http from "node:http";
import { runWithRequestContext, type RequestContext } from "./context";
import { logger } from "./logger";
import { httpRequestDuration, httpRequestsInFlight, httpRequestsTotal } from "./metrics";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const WORKSPACES = new Set(["partner", "builder", "finance", "admin"]);
const API_GROUPS = new Set(["health", "ready", "metrics", "documents", "builder", "finance", "admin"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * Maps a request onto a small, fixed set of route groups so metric cardinality stays bounded no matter
 * which URLs clients send.
 */
export function routeGroup(method: string, rawUrl: string, headers: http.IncomingHttpHeaders = {}): string {
  const pathname = (rawUrl.split("?")[0] ?? "/").toLowerCase();
  if (pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image") || /\.(?:svg|png|jpe?g|webp|ico|css|js|map|woff2?)$/.test(pathname)) {
    return "static";
  }
  if (method === "POST" && headers["next-action"]) return "server_action";
  const [first, second] = pathname.split("/").filter(Boolean);
  if (!first) return "home";
  if (first === "api") return second && API_GROUPS.has(second) ? `api_${second}` : "api_other";
  if (WORKSPACES.has(first)) return first;
  if (first === "login") return "login";
  if (first === "_next") return "next_internal";
  return "other";
}

function statusClass(status: number): string {
  return status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : "unknown";
}

const INSTALLED = Symbol.for("brickflow.observability.httpInstrumentation");

/**
 * Wraps every incoming HTTP request handled by this process: assigns or propagates `x-request-id`, runs
 * the request inside the logging context, records request metrics and writes one access-log line.
 * Installed once from `instrumentation.ts`; patching `emit` covers servers created before or after.
 */
export function installHttpInstrumentation(): void {
  const proto = http.Server.prototype as http.Server & Record<symbol, boolean | undefined>;
  if (proto[INSTALLED]) return;
  proto[INSTALLED] = true;

  const originalEmit = proto.emit;
  proto.emit = function emit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event !== "request") return Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
    const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
    const started = process.hrtime.bigint();
    const method = METHODS.has(req.method ?? "") ? req.method! : "OTHER";
    const group = routeGroup(method, req.url ?? "/", req.headers);
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId = resolveRequestId(Array.isArray(incoming) ? incoming[0] : incoming);
    req.headers[REQUEST_ID_HEADER] = requestId;
    if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, requestId);
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const context: RequestContext = { requestId, method, path };

    httpRequestsInFlight.inc();
    let finished = false;
    const done = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      httpRequestsInFlight.dec();
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const status = aborted && !res.writableFinished ? 499 : res.statusCode;
      httpRequestsTotal.inc({ route_group: group, method, status_class: aborted && !res.writableFinished ? "aborted" : statusClass(status) });
      httpRequestDuration.observe({ route_group: group, method }, seconds);
      if (group === "static" || group === "next_internal") return;
      const fields = { method, path, routeGroup: group, status, durationMs: Math.round(seconds * 1000) };
      runWithRequestContext(context, () => {
        if (status >= 500) logger.error("http.request", fields);
        else logger.info("http.request", fields);
      });
    };
    res.once("finish", () => done(false));
    res.once("close", () => done(true));

    return runWithRequestContext(context, () => Reflect.apply(originalEmit, this, [event, ...args]) as boolean);
  } as typeof proto.emit;
}
