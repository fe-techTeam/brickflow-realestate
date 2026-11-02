import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading invoice…</span>
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6 xl:col-start-2 xl:row-start-1">
          <div className="surface space-y-3 p-6">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          </div>
          <div className="surface space-y-4 p-6">
            <Skeleton className="h-5 w-36" />
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-6 xl:col-start-1 xl:row-start-1">
          <div className="surface p-6">
            <Skeleton className="mb-4 h-5 w-40" />
            <Skeleton className="h-[420px] w-full" />
          </div>
          <div className="surface grid gap-5 p-6 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
