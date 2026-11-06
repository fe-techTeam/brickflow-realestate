import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request values attached to every log line written while the request is being handled. */
export interface RequestContext {
  requestId: string;
  actorId?: string;
  method?: string;
  path?: string;
}

const STORAGE_KEY = Symbol.for("brickflow.observability.requestContext");

// The HTTP hook (instrumentation), route handlers and server components can be compiled into separate
// bundles; keeping the store on globalThis guarantees they all share one AsyncLocalStorage instance.
const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<RequestContext> | undefined>;
const storage: AsyncLocalStorage<RequestContext> = (holder[STORAGE_KEY] ??= new AsyncLocalStorage<RequestContext>());

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Records the authenticated user on the current request so later log lines carry the actor ID. */
export function setRequestActor(actorId: string | null | undefined): void {
  const store = storage.getStore();
  if (store && actorId) store.actorId = actorId;
}
