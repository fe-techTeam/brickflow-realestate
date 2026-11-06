"use client";

import { LogOut, Monitor, Smartphone } from "lucide-react";
import { ActionDialog } from "@/components/common/action-dialog";
import { ToneBadge } from "@/components/common/status-badge";
import { formatDateTime } from "@/lib/format";
import { describeUserAgent, isMobileUserAgent } from "@/lib/user-agent";
import { revokeSessionAction, signOutEverywhereAction } from "@/server/actions/security";

export interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  mfaVerified: boolean;
  current: boolean;
}

export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  return (
    <div className="grid gap-5">
      <ul className="-mx-5 divide-y divide-border/70 border-y border-border/70 sm:-mx-6">
        {sessions.map((session) => {
          const Icon = isMobileUserAgent(session.userAgent) ? Smartphone : Monitor;
          return (
            <li key={session.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-start gap-3.5">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-glass-50 text-fg-muted ring-1 ring-line ring-inset">
                  <Icon className="size-[1.05rem]" strokeWidth={1.6} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-fg">{describeUserAgent(session.userAgent)}</p>
                    {session.current && <ToneBadge meta={{ label: "This device", tone: "success" }} />}
                    {session.mfaVerified && <ToneBadge meta={{ label: "Verified with code", tone: "kota" }} />}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    <span className="tabular">{session.ip ?? "Unknown address"}</span>
                    <span aria-hidden="true"> · </span>
                    Signed in <span className="tabular">{formatDateTime(session.createdAt)}</span>
                    <span aria-hidden="true"> · </span>
                    Last active <span className="tabular">{formatDateTime(session.lastSeenAt)}</span>
                  </p>
                </div>
              </div>
              {!session.current && (
                <ActionDialog
                  trigger="Sign out"
                  triggerVariant="outline"
                  triggerSize="sm"
                  title="Sign out this session?"
                  description={`${describeUserAgent(session.userAgent)} will be signed out on its next request.`}
                  confirmLabel="Sign out session"
                  confirmVariant="destructive"
                  icon={LogOut}
                  action={() => revokeSessionAction(session.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">Lost a device or signed in somewhere you don&apos;t recognise? End every session, including this one.</p>
        <ActionDialog
          trigger="Sign out of all devices"
          triggerVariant="destructive"
          triggerSize="sm"
          triggerIcon={<LogOut className="size-3.5" />}
          title="Sign out of all devices?"
          description="Every session, including this one, ends immediately. You will need to sign in again."
          confirmLabel="Sign out everywhere"
          confirmVariant="destructive"
          action={() => signOutEverywhereAction()}
        />
      </div>
    </div>
  );
}
