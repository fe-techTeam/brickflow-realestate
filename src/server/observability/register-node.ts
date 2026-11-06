import { auditKeyring } from "@/lib/audit-keys";
import { installHttpInstrumentation } from "./http";
import { logger } from "./logger";

/** Node.js-only start-up hook, loaded from `instrumentation.ts`. */
export function registerNodeObservability(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  installHttpInstrumentation();
  try {
    const keyring = auditKeyring();
    if (keyring.insecure) logger.warn("audit.key.development", { keyId: keyring.currentKeyId, note: "Audit entries are sealed with the public development key." });
  } catch (error) {
    // Fail fast: without a valid audit key no state change could be recorded.
    logger.error("startup.audit_key_invalid", { err: error });
    process.exit(1);
  }
  logger.info("server.started", { nodeVersion: process.version, environment: process.env.NODE_ENV });
}
