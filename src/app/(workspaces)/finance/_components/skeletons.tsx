import { Skeleton } from "@/components/ui/skeleton";

export function HeaderSkeleton() {
  return (
    <div className="mb-8 space-y-3" aria-hidden="true">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-4 w-[28rem] max-w-full" />
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface space-y-6 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="surface overflow-hidden" aria-hidden="true">
      <div className="border-b border-border px-6 py-4">
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="divide-y divide-border/70">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 px-6 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className="surface p-6" aria-hidden="true">
      <Skeleton className="mb-5 h-5 w-40" />
      <Skeleton className={`w-full ${height}`} />
    </div>
  );
}

/** Generic list page: header, optional stats, toolbar and table. */
export function ListPageSkeleton({ stats = 0, rows = 6 }: { stats?: number; rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <HeaderSkeleton />
      {stats > 0 && (
        <div className="mb-6">
          <StatsSkeleton count={stats} />
        </div>
      )}
      <div className="mb-4 flex gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-48" />
      </div>
      <TableSkeleton rows={rows} />
    </div>
  );
}

/** Detail page: header and a two-column case-file layout. */
export function DetailPageSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <PanelSkeleton height="h-56" />
          <PanelSkeleton height="h-40" />
        </div>
        <div className="space-y-6">
          <PanelSkeleton height="h-32" />
          <PanelSkeleton height="h-48" />
        </div>
      </div>
    </div>
  );
}
