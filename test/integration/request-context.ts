/**
 * In-memory stand-ins for `next/headers` and `next/cache`, so server actions can be exercised end to
 * end (cookie → session row → actor → service) in Vitest:
 *
 *   vi.mock("next/headers", async () => (await import("./request-context")).nextHeaders);
 *   vi.mock("next/cache", async () => (await import("./request-context")).nextCache);
 */
export const cookieJar = new Map<string, string>();

export const requestHeaders = new Headers({
  "x-forwarded-for": "203.0.113.10",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36",
});

type CookieInit = { name: string; value: string };

export const nextHeaders = {
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    has: (name: string) => cookieJar.has(name),
    set: (nameOrInit: string | CookieInit, value?: string) => {
      if (typeof nameOrInit === "string") cookieJar.set(nameOrInit, value ?? "");
      else cookieJar.set(nameOrInit.name, nameOrInit.value);
    },
    delete: (nameOrInit: string | { name: string }) => {
      cookieJar.delete(typeof nameOrInit === "string" ? nameOrInit : nameOrInit.name);
    },
  }),
  headers: async () => requestHeaders,
};

export const nextCache = {
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
};

/** Runs an action that ends in `redirect()` and returns the target URL. */
export async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? null;
    throw error;
  }
}
