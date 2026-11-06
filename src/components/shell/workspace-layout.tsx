import type { ReactNode } from "react";
import { cookies } from "next/headers";
import type { WorkspaceKey } from "@/lib/workspaces";
import { requireWorkspace } from "@/server/auth/session";
import { getSettingString } from "@/server/settings";
import { AppShell } from "./app-shell";
import { SIDEBAR_COOKIE } from "./navigation";

/** Shared server layout for the four workspaces: enforces the role and renders the shell. */
export async function WorkspaceLayout({ workspace, children }: { workspace: WorkspaceKey; children: ReactNode }) {
  const actor = await requireWorkspace(workspace);
  const [cookieStore, supportEmail] = await Promise.all([cookies(), getSettingString("platform.supportEmail")]);
  return (
    <AppShell
      workspace={workspace}
      sidebarCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed"}
      supportEmail={supportEmail}
      user={{ name: actor.name, email: actor.email, orgName: actor.orgName, designation: actor.designation }}
    >
      {children}
    </AppShell>
  );
}
