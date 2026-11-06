import { randomUUID } from "node:crypto";
import { breakerFor, type CircuitBreaker } from "./circuit-breaker";
import { ProviderDownError } from "./errors";
import { consoleConnectorLogger, type ConnectorLogger } from "./log";
import { redactUrl } from "./redaction";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

const IDEMPOTENT_METHODS = new Set<HttpMethod>(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

export interface HttpRequest {
  /** Stable operation name for logs and errors, e.g. "gstin.verify". */
  operation: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  json?: unknown;
  timeoutMs?: number;
  /**
   * Marks a non-idempotent call (typically a POST lookup) as safe to repeat. Leave unset for calls
   * with side effects, such as a penny-drop transfer: those are retried only when the provider
   * provably did not process them (HTTP 429).
   */
  retrySafe?: boolean;
  maxRetries?: number;
  requestId?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  /** Parsed JSON body, or undefined when the body is empty or not JSON. */
  json: unknown;
  durationMs: number;
  attempts: number;
  requestId: string;
}

export interface ResilientHttpClientOptions {
  provider: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string> | (() => Record<string, string>);
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  breaker?: CircuitBreaker;
  fetchImpl?: typeof fetch;
  logger?: ConnectorLogger;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parses Retry-After (delta seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * fetch-based HTTP client with a per-call timeout, retries with exponential backoff and full jitter,
 * a per-provider circuit breaker, request-ID propagation and redacted structured logs.
 *
 * Non-2xx responses are returned, not thrown: each adapter maps its provider's documented error
 * bodies to typed connector errors. Network failures, timeouts and an open circuit throw
 * ProviderDownError.
 */
export class ResilientHttpClient {
  readonly provider: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: ConnectorLogger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: ResilientHttpClientOptions) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.maxDelayMs = options.maxDelayMs ?? 4_000;
    this.breaker = options.breaker ?? breakerFor(options.provider);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? consoleConnectorLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  private url(request: HttpRequest): string {
    const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** Full-jitter exponential backoff: random(0, min(max, base · 2^attempt)). */
  backoffMs(attempt: number): number {
    const ceiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(this.random() * ceiling);
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const requestId = request.requestId ?? randomUUID();
    const url = this.url(request);
    const logPath = redactUrl(url.slice(this.baseUrl.length));
    const retryable = IDEMPOTENT_METHODS.has(request.method) || request.retrySafe === true;
    const maxRetries = request.maxRetries ?? this.maxRetries;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const defaults = typeof this.options.defaultHeaders === "function" ? this.options.defaultHeaders() : (this.options.defaultHeaders ?? {});
    const headers: Record<string, string> = {
      accept: "application/json",
      ...defaults,
      ...request.headers,
      "x-request-id": requestId,
    };
    if (request.json !== undefined) headers["content-type"] = "application/json";
    const body = request.json === undefined ? undefined : JSON.stringify(request.json);
    const logBase = { provider: this.provider, operation: request.operation, requestId, method: request.method, path: logPath };
    const started = Date.now();

    for (let attempt = 0; ; attempt++) {
      if (!this.breaker.tryAcquire()) {
        this.logger.log("warn", "circuit open; failing fast", { ...logBase, retryInMs: this.breaker.remainingOpenMs() });
        throw new ProviderDownError(`${this.provider} is temporarily unavailable (circuit open).`, {
          provider: this.provider,
          operation: request.operation,
          requestId,
          retryAfterMs: this.breaker.remainingOpenMs(),
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const attemptStarted = Date.now();
      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await this.fetchImpl(url, { method: request.method, headers, body, signal: controller.signal, cache: "no-store" });
      } catch (error) {
        failure = error;
      }

      let text = "";
      if (response) {
        try {
          text = await response.text();
        } catch (error) {
          failure = error;
          response = undefined;
        }
      }
      clearTimeout(timer);
      const attemptMs = Date.now() - attemptStarted;

      if (!response) {
        this.breaker.recordFailure();
        const timedOut = controller.signal.aborted;
        const reason = timedOut ? `timed out after ${timeoutMs} ms` : failure instanceof Error ? failure.message : "network error";
        if (retryable && attempt < maxRetries) {
          const delay = this.backoffMs(attempt);
          this.logger.log("warn", "request failed; retrying", { ...logBase, attempt: attempt + 1, reason, retryInMs: delay, durationMs: attemptMs });
          await this.sleep(delay);
          continue;
        }
        this.logger.log("error", "request failed", { ...logBase, attempts: attempt + 1, reason, durationMs: Date.now() - started });
        throw new ProviderDownError(`${this.provider} did not respond (${reason}).`, { provider: this.provider, operation: request.operation, requestId, cause: failure });
      }

      const status = response.status;
      if (RETRYABLE_STATUSES.has(status)) this.breaker.recordFailure();
      else this.breaker.recordSuccess();

      // 429 means the provider rejected the call before processing it, so even side-effecting calls may be repeated.
      const shouldRetry = attempt < maxRetries && (status === 429 || (retryable && RETRYABLE_STATUSES.has(status)));
      if (shouldRetry) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delay = Math.min(this.maxDelayMs, retryAfter ?? this.backoffMs(attempt));
        this.logger.log("warn", "retryable response; retrying", { ...logBase, attempt: attempt + 1, status, retryInMs: delay, durationMs: attemptMs });
        await this.sleep(delay);
        continue;
      }

      const durationMs = Date.now() - started;
      this.logger.log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "provider call completed", {
        ...logBase,
        status,
        attempts: attempt + 1,
        durationMs,
      });
      return { status, ok: status >= 200 && status < 300, headers: response.headers, text, json: parseJson(text), durationMs, attempts: attempt + 1, requestId };
    }
  }
}
