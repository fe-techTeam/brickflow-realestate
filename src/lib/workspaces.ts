import type { OrganisationType, RoleKey } from "@/generated/prisma/enums";

export type WorkspaceKey = "partner" | "builder" | "finance" | "admin";

export interface WorkspaceDefinition {
  key: WorkspaceKey;
  label: string;
  shortLabel: string;
  basePath: `/${WorkspaceKey}`;
  orgType: OrganisationType;
  role: RoleKey;
}

export const WORKSPACES: Record<WorkspaceKey, WorkspaceDefinition> = {
  partner: {
    key: "partner",
    label: "Channel Partner Portal",
    shortLabel: "Channel Partner",
    basePath: "/partner",
    orgType: "CHANNEL_PARTNER",
    role: "CP_ADMIN",
  },
  builder: {
    key: "builder",
    label: "Builder Portal",
    shortLabel: "Builder",
    basePath: "/builder",
    orgType: "BUILDER",
    role: "BUILDER_ACCOUNTS",
  },
  finance: {
    key: "finance",
    label: "Veefin Finance Portal",
    shortLabel: "Veefin Finance",
    basePath: "/finance",
    orgType: "FINANCIER",
    role: "FINANCE_OPS",
  },
  admin: {
    key: "admin",
    label: "Super Admin",
    shortLabel: "Super Admin",
    basePath: "/admin",
    orgType: "PLATFORM",
    role: "SUPER_ADMIN",
  },
};

export function workspaceForOrgType(type: OrganisationType): WorkspaceDefinition {
  const match = Object.values(WORKSPACES).find((w) => w.orgType === type);
  if (!match) throw new Error(`No workspace for organisation type ${type}`);
  return match;
}

export interface DemoAccount {
  workspace: WorkspaceKey;
  email: string;
  name: string;
  org: string;
}

const WORKSPACE_ORDER: WorkspaceKey[] = ["partner", "builder", "finance", "admin"];

/** One-click sign-in cards for a demo dataset, in workspace order. */
export function demoAccountsFor(users: ReadonlyArray<{ email: string; name: string; org: string; role: RoleKey; loginCard?: boolean }>, orgName: (orgKey: string) => string): DemoAccount[] {
  return users
    .filter((u) => u.loginCard)
    .flatMap((u) => {
      const workspace = Object.values(WORKSPACES).find((w) => w.role === u.role);
      return workspace ? [{ workspace: workspace.key, email: u.email, name: u.name, org: orgName(u.org) }] : [];
    })
    .sort((a, b) => WORKSPACE_ORDER.indexOf(a.workspace) - WORKSPACE_ORDER.indexOf(b.workspace));
}
