import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CARD } from "./kit";

/** Loading placeholder matching the builder page layout: header, optional stat row, optional chart and a table. */
export function PageSkeleton({ stats = 0, chart = false, rows = 6, toolbar = true }: { stats?: number; chart?: boolean; rows?: number; toolbar?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-8 space-y-4 border-b border-[#dfe2de] pb-8 sm:mb-10">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-11 w-80 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      {stats > 0 && (
        <div className={cn(CARD, "mb-8 grid gap-px overflow-hidden bg-[#e4e7e3] sm:grid-cols-2", stats >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="space-y-6 bg-card p-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
      )}
      {chart && (
        <div className={cn(CARD, "mb-8 p-7")}>
          <Skeleton className="mb-6 h-5 w-48" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}
      <div className={cn(CARD, "overflow-hidden")}>
        {toolbar && (
          <div className="flex flex-wrap gap-3 border-b border-border/80 px-6 py-4">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-44" />
          </div>
        )}
        <div className="divide-y divide-border/70">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-6 px-6 py-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
