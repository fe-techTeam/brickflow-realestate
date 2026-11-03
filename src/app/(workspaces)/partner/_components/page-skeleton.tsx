import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-md", className)} />;
}

/** Route-level loading placeholder matching the page intro, metric strip and panel layout. */
export function PageSkeleton({ stats = 0, rows = 6, split = false }: { stats?: number; rows?: number; split?: boolean }) {
  const cells = Math.min(stats, 4);
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-fade-in">
      <div className="mb-10">
        <Bar className="mb-4 h-3 w-40" />
        <Bar className="h-10 w-80 max-w-full" />
        <Bar className="mt-4 h-4 w-[30rem] max-w-full" />
        <div className="relative mt-7 h-px bg-hairline">
          <span className="absolute top-0 left-0 h-px w-20 bg-gold/60" />
        </div>
      </div>
      {cells > 0 && (
        <div className="surface mb-8 grid grid-cols-2 overflow-hidden lg:grid-cols-4">
          {Array.from({ length: cells }, (_, i) => (
            <div key={i} className={cn("flex h-32 flex-col justify-between border-hairline p-6", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i > 0 && "lg:border-l")}>
              <Bar className="h-2.5 w-24" />
              <Bar className="h-8 w-28" />
            </div>
          ))}
        </div>
      )}
      <div className={split ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" : undefined}>
        <div className="surface p-7">
          <Bar className="mb-2 h-2.5 w-24" />
          <Bar className="mb-7 h-6 w-48" />
          <div className="space-y-5">
            {Array.from({ length: rows }, (_, i) => (
              <Bar key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        {split && (
          <div className="flex flex-col gap-6">
            <div className="surface-navy h-56" />
            <div className="surface p-6">
              <Bar className="mb-5 h-5 w-32" />
              <Bar className="h-16 w-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
