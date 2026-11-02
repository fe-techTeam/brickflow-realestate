import { HeaderSkeleton, PanelSkeleton, StatsSkeleton } from "../_components/skeletons";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <HeaderSkeleton />
      <StatsSkeleton count={4} />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}
