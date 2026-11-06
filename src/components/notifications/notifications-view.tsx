import Link from "next/link";
import { BellOff } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { formatDateTime } from "@/lib/format";
import { isNotificationCategory, NOTIFICATION_CATEGORIES } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import type { WorkspaceKey } from "@/lib/workspaces";
import { requireWorkspace } from "@/server/auth/session";
import { getNotificationSettings, listNotifications } from "@/server/notifications/inbox";
import { MarkAllReadButton, NotificationRowActions, PreferencesForm } from "./notification-controls";
import { relativeTime } from "./relative-time";

const PAGE = 30;
const MAX = 200;

type SearchParams = Record<string, string | string[] | undefined>;

/** The "all notifications" page and the preferences form, shared by every workspace. */
export async function NotificationsView({ workspace, searchParams }: { workspace: WorkspaceKey; searchParams: SearchParams }) {
  const actor = await requireWorkspace(workspace);
  const unreadOnly = searchParams.filter === "unread";
  const requested = Number.parseInt(typeof searchParams.take === "string" ? searchParams.take : "", 10);
  const take = Number.isFinite(requested) ? Math.min(Math.max(requested, PAGE), MAX) : PAGE;
  const [inbox, settings] = await Promise.all([listNotifications(actor.userId, { unreadOnly, take }), getNotificationSettings(actor.userId)]);
  const base = `/${workspace}/notifications`;
  const now = new Date();

  const tabs = [
    { label: "All", href: base, active: !unreadOnly },
    { label: `Unread${inbox.unread ? ` · ${inbox.unread}` : ""}`, href: `${base}?filter=unread`, active: unreadOnly },
  ];
  const moreHref = `${base}?${new URLSearchParams({ ...(unreadOnly ? { filter: "unread" } : {}), take: String(Math.min(take + PAGE, MAX)) }).toString()}`;

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description="Updates on your invoices, early-payment offers, payouts and settlements, and how you would like to receive them."
        actions={<MarkAllReadButton disabled={inbox.unread === 0} />}
      />

      <div className="grid gap-6">
        <Section
          title="Inbox"
          description={inbox.unread ? `${inbox.unread} unread` : "You are all caught up."}
          actions={
            <nav aria-label="Filter notifications" className="flex gap-1.5">
              {tabs.map((tab) => (
                <Link
                  key={tab.label}
                  href={tab.href}
                  scroll={false}
                  aria-current={tab.active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors",
                    tab.active ? "border-line-strong bg-glass-300 text-fg" : "border-border text-fg-soft hover:border-line-strong/60 hover:text-fg",
                  )}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          }
          bodyClassName="p-0"
        >
          {inbox.items.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title={unreadOnly ? "No unread notifications" : "No notifications yet"}
              description="Workflow updates appear here as soon as they happen."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {inbox.items.map((item) => (
                <li key={item.id} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5 sm:px-6", !item.read && "bg-glass-50")}>
                  <span aria-hidden="true" className={cn("hidden size-2 shrink-0 rounded-full sm:block", item.read ? "bg-transparent" : "bg-signal-500")} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className={cn("text-sm", item.read ? "text-fg-soft" : "font-medium text-fg")}>
                        {!item.read && <span className="sr-only">Unread: </span>}
                        {item.title}
                      </span>
                      {isNotificationCategory(item.category) && (
                        <span className="text-[0.6875rem] tracking-wide text-fg-muted uppercase">{NOTIFICATION_CATEGORIES[item.category].label}</span>
                      )}
                    </p>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{item.body}</p>
                    <p className="mt-1 text-[0.6875rem] text-fg-muted">
                      <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                        {relativeTime(item.createdAt, now)}
                      </time>
                    </p>
                  </div>
                  <NotificationRowActions id={item.id} link={item.link} read={item.read} />
                </li>
              ))}
            </ul>
          )}
          {inbox.hasMore && take < MAX && (
            <div className="border-t hairline px-5 py-3 text-center sm:px-6">
              <Link href={moreHref} scroll={false} className="text-[0.8125rem] font-medium text-fg-soft underline-offset-4 hover:text-fg hover:underline">
                Show older notifications
              </Link>
            </div>
          )}
        </Section>

        <Section
          id="preferences"
          title="Preferences"
          description="Choose how you hear about each kind of update. Changes apply to messages sent from now on."
        >
          <PreferencesForm initial={settings} whatsappAvailable={process.env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "cloud"} />
        </Section>
      </div>
    </>
  );
}
