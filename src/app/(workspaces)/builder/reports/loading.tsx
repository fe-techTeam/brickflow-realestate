import { PageSkeleton } from "../_components/page-skeleton";

export default function Loading() {
  return <PageSkeleton stats={4} chart rows={3} toolbar={false} />;
}
