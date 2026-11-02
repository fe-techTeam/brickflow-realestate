export type SearchParams = Record<string, string | string[] | undefined>;

export function param(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Returns the param only when it is one of the allowed values. */
export function enumParam<T extends string>(searchParams: SearchParams, key: string, allowed: readonly T[]): T | undefined {
  const value = param(searchParams, key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
