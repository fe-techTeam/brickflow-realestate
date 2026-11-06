import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeObservability } = await import("./server/observability/register-node");
    registerNodeObservability();
  }
}

/** Logs render, route-handler and server-action failures that escape application error handling. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./server/observability/request-error");
  reportRequestError(error, request, context);
};
