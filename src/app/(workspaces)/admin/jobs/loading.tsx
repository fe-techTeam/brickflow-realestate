import { PageSkeleton } from "../_components/page-skeleton";

export default function Loading() {
  return <PageSkeleton stats={5} rows={6} columns={6} />;
}
