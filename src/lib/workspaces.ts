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

export const DEMO_ACCOUNTS = [
  { workspace: "partner", email: "partner@prestige-demo.test", name: "Ananya Rao", org: "Prestige Realty Partners" },
  { workspace: "builder", email: "accounts@godrej-demo.test", name: "Rohan Mehta", org: "Godrej Properties Demo" },
  { workspace: "finance", email: "finance@brickflow.demo", name: "Kavita Iyer", org: "Veefin Finance Demo" },
  { workspace: "admin", email: "admin@brickflow.demo", name: "Arjun Shah", org: "BrickFlow Platform" },
] as const satisfies ReadonlyArray<{ workspace: WorkspaceKey; email: string; name: string; org: string }>;
