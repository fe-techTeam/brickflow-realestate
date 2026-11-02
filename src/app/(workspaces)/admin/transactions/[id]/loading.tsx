import { PageSkeleton } from "../../_components/page-skeleton";

export default function Loading() {
  return <PageSkeleton stats={4} rows={5} columns={4} />;
}
