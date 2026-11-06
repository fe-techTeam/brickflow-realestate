import type { ReactNode } from "react";
import { cookies } from "next/headers";
import type { WorkspaceKey } from "@/lib/workspaces";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { requireWorkspace } from "@/server/auth/session";
import { getInboxSummary } from "@/server/notifications/inbox";
import { AppShell } from "./app-shell";
import { SIDEBAR_COOKIE } from "./navigation";

/** Shared server layout for the four workspaces: enforces the role and renders the shell. */
export async function WorkspaceLayout({ workspace, children }: { workspace: WorkspaceKey; children: ReactNode }) {
  const actor = await requireWorkspace(workspace);
  const [cookieStore, inbox] = await Promise.all([cookies(), getInboxSummary(actor.userId)]);
  return (
    <AppShell
      workspace={workspace}
      sidebarCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed"}
      user={{ name: actor.name, email: actor.email, orgName: actor.orgName, designation: actor.designation }}
      notifications={<NotificationBell workspace={workspace} initial={inbox} />}
    >
      {children}
    </AppShell>
  );
}
