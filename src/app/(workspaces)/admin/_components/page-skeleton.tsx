import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder matching the admin page layout: header, optional stat row and a table. */
export function PageSkeleton({ stats = 0, rows = 6, columns = 6 }: { stats?: number; rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      {stats > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="surface space-y-6 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
      )}
      <div className="surface overflow-hidden">
        <div className="border-b border-border/80 px-6 py-4">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="space-y-4 px-6 py-5">
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns }, (_, c) => (
                <Skeleton key={c} className="h-4" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
