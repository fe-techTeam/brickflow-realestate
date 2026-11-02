"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface ToolbarFilter {
  /** URL search param name. */
  param: string;
  label: string;
  options: { value: string; label: string }[];
}

const ALL = "__all";

/** Search + filter controls bound to URL search params, so server pages can filter and the view is shareable. */
export function ListToolbar({ searchPlaceholder = "Search…", filters = [] }: { searchPlaceholder?: string; filters?: ToolbarFilter[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;
    const handle = setTimeout(() => update({ q: query.trim() || null }), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const active = Boolean(params.get("q")) || filters.some((f) => params.get(f.param));

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
          className="h-9 bg-card pl-9"
        />
      </div>
      {filters.map((filter) => (
        <Select key={filter.param} value={params.get(filter.param) ?? ALL} onValueChange={(v) => update({ [filter.param]: v === ALL ? null : v })}>
          <SelectTrigger className="h-9 w-full bg-card sm:w-52" aria-label={filter.label}>
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All {filter.label.toLowerCase()}</SelectItem>
            {filter.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery("");
            update(Object.fromEntries([["q", null], ...filters.map((f) => [f.param, null])]));
          }}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating results" />}
    </div>
  );
}
