import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SearchParams } from "../_lib/params";

export interface ViewTab {
  value: string;
  label: string;
  count?: number;
}

/**
 * Segmented links bound to a URL param. Switching view keeps search/sort params but drops `resetParams`
 * (e.g. a status filter whose options differ per view).
 */
export function ViewTabs({
  tabs,
  current,
  param,
  pathname,
  searchParams,
  resetParams = [],
  label,
}: {
  tabs: ViewTab[];
  current: string;
  param: string;
  pathname: string;
  searchParams: SearchParams;
  resetParams?: string[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border border-border bg-card p-1 shadow-xs">
      {tabs.map((tab, index) => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(searchParams)) {
          if (typeof v === "string" && k !== param && !resetParams.includes(k)) params.set(k, v);
        }
        if (index > 0) params.set(param, tab.value);
        const qs = params.toString();
        const active = tab.value === current;
        return (
          <Link
            key={tab.value}
            href={qs ? `${pathname}?${qs}` : pathname}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
              active ? "bg-night text-white" : "text-muted-foreground hover:bg-muted hover:text-fg",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn("tabular rounded-full px-1.5 text-[0.6875rem]", active ? "bg-card/15 text-white" : "bg-muted text-fg-soft")}>{tab.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
