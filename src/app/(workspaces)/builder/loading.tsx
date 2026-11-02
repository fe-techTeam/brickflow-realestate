import { PageSkeleton } from "./_components/page-skeleton";

export default function Loading() {
  return <PageSkeleton stats={5} chart rows={4} toolbar={false} />;
}
