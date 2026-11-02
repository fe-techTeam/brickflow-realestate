import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading placeholder matching the PageHeader + stat grid + section layout. */
export function PageSkeleton({ stats = 0, rows = 6, split = false }: { stats?: number; rows?: number; split?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-in fade-in-0">
      <div className="mb-8">
        <Skeleton className="mb-3 h-3 w-32" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-[28rem] max-w-full" />
      </div>
      {stats > 0 && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="surface flex h-32 flex-col justify-between p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
      )}
      <div className={split ? "grid gap-6 lg:grid-cols-3" : undefined}>
        <div className={split ? "surface p-6 lg:col-span-2" : "surface p-6"}>
          <Skeleton className="mb-6 h-5 w-40" />
          <div className="space-y-4">
            {Array.from({ length: rows }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
        {split && (
          <div className="surface p-6">
            <Skeleton className="mb-6 h-5 w-32" />
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
