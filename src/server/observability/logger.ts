import packageJson from "../../../package.json";
import { getRequestContext } from "./context";
import { redact, scrubText, serialiseError } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface LogRecord {
  level: LogLevel;
  time: string;
  message: string;
  service: string;
  version: string;
  requestId?: string;
  actorId?: string;
  [field: string]: unknown;
}

export type LogSink = (record: LogRecord, line: string) => void;

const RESERVED = new Set(["level", "time", "message", "service", "version", "requestId", "actorId"]);

function thresholdFromEnv(): number {
  const configured = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured as LogLevel | "silent"];
  // Test runs stay quiet unless a test opts in; everything else logs from info upwards.
  return process.env.NODE_ENV === "test" ? LEVEL_ORDER.silent : LEVEL_ORDER.info;
}

const defaultSink: LogSink = (record, line) => {
  const stream = record.level === "error" || record.level === "warn" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

let sink: LogSink = defaultSink;
let thresholdOverride: number | undefined;

/** Replaces the output sink (tests capture records this way). Returns a function that restores the previous sink. */
export function setLogSink(next: LogSink, level: LogLevel = "debug"): () => void {
  const previous = sink;
  const previousThreshold = thresholdOverride;
  sink = next;
  thresholdOverride = LEVEL_ORDER[level];
  return () => {
    sink = previous;
    thresholdOverride = previousThreshold;
  };
}

function serviceName(): string {
  return process.env.SERVICE_NAME?.trim() || "brickflow-web";
}

export function serviceVersion(): string {
  return process.env.APP_VERSION?.trim() || packageJson.version;
}

function normaliseFields(fields: LogFields | Error | undefined): LogFields {
  if (!fields) return {};
  if (fields instanceof Error) return { err: fields };
  return fields;
}

function write(level: LogLevel, bindings: LogFields, message: string, fields?: LogFields | Error): void {
  if (LEVEL_ORDER[level] < (thresholdOverride ?? thresholdFromEnv())) return;
  const context = getRequestContext();
  const extra = { ...bindings, ...normaliseFields(fields) };
  const record: LogRecord = {
    level,
    time: new Date().toISOString(),
    message: scrubText(message),
    service: serviceName(),
    version: serviceVersion(),
  };
  if (context?.requestId) record.requestId = context.requestId;
  if (context?.actorId) record.actorId = context.actorId;

  for (const [key, value] of Object.entries(extra)) {
    if (RESERVED.has(key)) continue;
    const safe = value instanceof Error ? serialiseError(value, new WeakSet(), 0) : redact({ [key]: value });
    if (value instanceof Error) record[key] = safe;
    else if (safe && typeof safe === "object" && key in safe) record[key] = (safe as LogFields)[key];
  }

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ level, time: record.time, message: record.message, service: record.service, version: record.version, serialisationError: true });
  }
  try {
    sink(record, line);
  } catch {
    // Logging must never take the request down.
  }
}

export interface Logger {
  debug(message: string, fields?: LogFields | Error): void;
  info(message: string, fields?: LogFields | Error): void;
  warn(message: string, fields?: LogFields | Error): void;
  error(message: string, fields?: LogFields | Error): void;
  /** A logger that adds the given fields (e.g. `{ component: "db" }`) to every line. */
  child(bindings: LogFields): Logger;
}

function createLogger(bindings: LogFields): Logger {
  return {
    debug: (message, fields) => write("debug", bindings, message, fields),
    info: (message, fields) => write("info", bindings, message, fields),
    warn: (message, fields) => write("warn", bindings, message, fields),
    error: (message, fields) => write("error", bindings, message, fields),
    child: (more) => createLogger({ ...bindings, ...more }),
  };
}

/**
 * Structured JSON-lines logger. Every line carries level, time, message, service and version, plus the
 * request ID and actor ID of the request being handled. Field values pass through `redact()`, so
 * secrets and personal identifiers never reach the log stream.
 */
export const logger: Logger = createLogger({});
