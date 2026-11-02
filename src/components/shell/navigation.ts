import {
  ArrowDownToLine,
  BadgePercent,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileStack,
  FileText,
  FileUp,
  Handshake,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Receipt,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  Wallet,
} from "lucide-react";
import type { WorkspaceKey } from "@/lib/workspaces";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Match only the exact path (used for workspace roots). */
  exact?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAVIGATION: Record<WorkspaceKey, NavSection[]> = {
  partner: [
    {
      items: [
        { title: "Overview", href: "/partner", icon: LayoutDashboard, exact: true },
        { title: "My Invoices", href: "/partner/invoices", icon: FileStack },
        { title: "Upload Invoice", href: "/partner/invoices/new", icon: FileUp, exact: true },
      ],
    },
    {
      label: "Early payment",
      items: [
        { title: "Financing Offers", href: "/partner/offers", icon: BadgePercent },
        { title: "My Transactions", href: "/partner/transactions", icon: Receipt },
        { title: "Disbursements", href: "/partner/disbursements", icon: Wallet },
      ],
    },
    {
      label: "Account",
      items: [
        { title: "Documents", href: "/partner/documents", icon: FileText },
        { title: "Organisation Profile", href: "/partner/profile", icon: UserCircle2 },
      ],
    },
  ],
  builder: [
    {
      items: [
        { title: "Overview", href: "/builder", icon: LayoutDashboard, exact: true },
        { title: "Channel Partners", href: "/builder/partners", icon: Handshake },
        { title: "Projects", href: "/builder/projects", icon: Building2 },
      ],
    },
    {
      label: "Invoices",
      items: [
        { title: "Invoice Approvals", href: "/builder/approvals", icon: ClipboardCheck },
        { title: "Approved Invoices", href: "/builder/approved", icon: CheckCircle2 },
        { title: "Financed Invoices", href: "/builder/financed", icon: HandCoins },
      ],
    },
    {
      label: "Finance",
      items: [
        { title: "Settlements", href: "/builder/settlements", icon: Landmark },
        { title: "Reports", href: "/builder/reports", icon: BarChart3 },
      ],
    },
  ],
  finance: [
    {
      items: [
        { title: "Overview", href: "/finance", icon: LayoutDashboard, exact: true },
        { title: "Builders", href: "/finance/builders", icon: Building2 },
        { title: "Channel Partners", href: "/finance/partners", icon: Handshake },
        { title: "Financing Programmes", href: "/finance/programmes", icon: BadgePercent },
      ],
    },
    {
      label: "Operations",
      items: [
        { title: "Financing Requests", href: "/finance/requests", icon: ListChecks },
        { title: "Disbursements", href: "/finance/disbursements", icon: ArrowDownToLine },
        { title: "Transactions", href: "/finance/transactions", icon: Receipt },
        { title: "Reports", href: "/finance/reports", icon: BarChart3 },
      ],
    },
  ],
  admin: [
    {
      items: [{ title: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true }],
    },
    {
      label: "Directory",
      items: [
        { title: "Organisations", href: "/admin/organisations", icon: Landmark },
        { title: "Users", href: "/admin/users", icon: Users },
        { title: "Builders", href: "/admin/builders", icon: Building2 },
        { title: "Channel Partners", href: "/admin/partners", icon: Handshake },
      ],
    },
    {
      label: "Platform",
      items: [
        { title: "Financing Configuration", href: "/admin/financing", icon: BadgePercent },
        { title: "Transactions", href: "/admin/transactions", icon: Receipt },
        { title: "Audit Logs", href: "/admin/audit", icon: ShieldCheck },
        { title: "Settings", href: "/admin/settings", icon: Settings },
      ],
    },
  ],
};

