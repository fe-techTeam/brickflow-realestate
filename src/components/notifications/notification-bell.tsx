"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { WorkspaceKey } from "@/lib/workspaces";
import { getNotificationSummaryAction, markNotificationsReadAction } from "@/server/actions/notifications";
import type { InboxItem } from "@/server/notifications/inbox";
import { relativeTime } from "./relative-time";

const POLL_MS = 60_000;

export interface InboxSummary {
  unread: number;
  items: InboxItem[];
}

/** Top-bar bell: unread count, the latest notifications, mark as read, and a link to the full list. */
export function NotificationBell({ workspace, initial }: { workspace: WorkspaceKey; initial: InboxSummary }) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // A server refresh (navigation, router.refresh) supplies a newer summary.
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setSummary(initial);
  }

  const refresh = useCallback(async () => {
    const result = await getNotificationSummaryAction();
    if (result.ok) setSummary(result.data);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  function openItem(item: InboxItem) {
    setOpen(false);
    if (!item.read) {
      setSummary((s) => ({ unread: Math.max(0, s.unread - 1), items: s.items.map((i) => (i.id === item.id ? { ...i, read: true } : i)) }));
      void markNotificationsReadAction([item.id]);
    }
    if (item.link) router.push(item.link);
  }

  function markAll() {
    startTransition(async () => {
      const result = await markNotificationsReadAction("all");
      if (result.ok) {
        setSummary((s) => ({ unread: 0, items: s.items.map((i) => ({ ...i, read: true })) }));
        router.refresh();
      }
    });
  }

  const label = summary.unread > 0 ? `Notifications, ${summary.unread} unread` : "Notifications";

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <DropdownMenuTrigger
        aria-label={label}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors outline-none hover:bg-glass-200/60 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-glass-200/60 data-[state=open]:text-fg"
      >
        <Bell className="size-[1.125rem]" strokeWidth={1.6} />
        {summary.unread > 0 && (
          <span
            aria-hidden="true"
            className="tabular absolute -top-0.5 -right-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-signal-500 px-1 text-[0.625rem] leading-none font-semibold text-night-solid ring-2 ring-background"
          >
            {summary.unread > 99 ? "99+" : summary.unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-3 border-b hairline px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg">Notifications</p>
            <p className="text-[0.6875rem] text-muted-foreground">{summary.unread > 0 ? `${summary.unread} unread` : "You are all caught up"}</p>
          </div>
          {summary.unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] font-medium text-fg-soft transition-colors hover:bg-glass-200/60 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              <CheckCheck className="size-3.5" />
              Mark all as read
            </button>
          )}
        </div>
        {summary.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <BellOff className="size-5 text-fg-muted" strokeWidth={1.5} />
            <p className="text-sm text-fg-soft">No notifications yet</p>
            <p className="max-w-[16rem] text-xs text-muted-foreground">Updates on invoices, offers, payouts and settlements will appear here.</p>
          </div>
        ) : (
          <ul className="max-h-[min(26rem,60vh)] overflow-y-auto py-1">
            {summary.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="group flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-glass-200/50 focus-visible:bg-glass-200/50 focus-visible:outline-none"
                >
                  <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-signal-500")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[0.8125rem] leading-snug", item.read ? "text-fg-soft" : "font-medium text-fg")}>{item.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{item.body}</span>
                    <span className="mt-1 block text-[0.6875rem] text-fg-muted">
                      {item.read ? "" : <span className="sr-only">Unread · </span>}
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t hairline p-1.5">
          <Link
            href={`/${workspace}/notifications`}
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-center text-[0.8125rem] font-medium text-fg-soft transition-colors hover:bg-glass-200/60 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            View all notifications
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
