import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder matching the admin page layout: editorial header, optional summary strip and a ledger. */
export function PageSkeleton({ stats = 0, rows = 6, columns = 6 }: { stats?: number; rows?: number; columns?: number }) {
  const strip = Math.min(stats, 4);
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-8">
      <div className="space-y-4">
        <Skeleton className="h-2.5 w-32 bg-gold/20" />
        <Skeleton className="h-11 w-80 max-w-full" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
        <div className="h-px bg-gradient-to-r from-gold/40 via-border to-transparent pt-px" />
      </div>
      {strip > 0 && (
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/90 bg-card lg:grid-cols-4">
          {Array.from({ length: strip }, (_, i) => (
            <div key={i} className="space-y-4 border-border/80 px-6 py-5 [&:not(:first-child)]:border-l">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border/90 bg-card">
        <div className="space-y-2.5 px-7 pt-6 pb-5">
          <Skeleton className="h-2.5 w-20 bg-gold/20" />
          <Skeleton className="h-6 w-52" />
        </div>
        <div className="border-y border-border/90 bg-ivory/40 px-7 py-3">
          <Skeleton className="h-2.5 w-full max-w-3xl" />
        </div>
        <div className="divide-y divide-border/60">
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="grid gap-6 px-7 py-5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns }, (_, c) => (
                <Skeleton key={c} className={c === 0 ? "h-4" : "h-3.5"} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
