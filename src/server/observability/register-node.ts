import { installHttpInstrumentation } from "./http";
import { logger } from "./logger";

/** Node.js-only start-up hook, loaded from `instrumentation.ts`. */
export function registerNodeObservability(): void {
  installHttpInstrumentation();
  logger.info("server.started", { nodeVersion: process.version, environment: process.env.NODE_ENV });
}
