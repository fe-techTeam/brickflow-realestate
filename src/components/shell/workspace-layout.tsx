import type { ReactNode } from "react";
import type { WorkspaceKey } from "@/lib/workspaces";
import { requireWorkspace } from "@/server/auth/session";
import { getSettings } from "@/server/services/admin";
import { AppShell } from "./app-shell";

/** Shared server layout for the four workspaces: enforces the role and renders the shell. */
export async function WorkspaceLayout({ workspace, children }: { workspace: WorkspaceKey; children: ReactNode }) {
  const actor = await requireWorkspace(workspace);
  const settings = await getSettings();
  return (
    <AppShell
      workspace={workspace}
      banner={settings["platform.demoBanner"]}
      user={{ name: actor.name, email: actor.email, orgName: actor.orgName, designation: actor.designation }}
    >
      {children}
    </AppShell>
  );
}
