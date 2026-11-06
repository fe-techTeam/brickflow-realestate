import type { Metadata } from "next";
import { NotificationsView } from "@/components/notifications/notifications-view";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NotificationsView workspace="partner" searchParams={await searchParams} />;
}
