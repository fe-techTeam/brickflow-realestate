import { redact } from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ConnectorLogger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

/** One JSON line per event; every field passes through redaction first. */
export const consoleConnectorLogger: ConnectorLogger = {
  log(level, message, fields = {}) {
    if (level === "debug" && process.env.CONNECTOR_DEBUG !== "true") return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, component: "connector", msg: message, ...redact(fields) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  },
};

export const silentConnectorLogger: ConnectorLogger = { log() {} };
