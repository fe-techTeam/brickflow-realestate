"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { NAVIGATION } from "./navigation";
import { activeHref } from "./sidebar-nav";

const SEGMENT_LABELS: Record<string, string> = { new: "New", edit: "Edit" };

/** Singular record names, used when a dynamic id follows a collection segment. */
const RECORD_LABELS: Record<string, string> = {
  invoices: "Invoice",
  requests: "Financing request",
  transactions: "Transaction",
  organisations: "Organisation",
  builders: "Builder",
  partners: "Channel partner",
  programmes: "Programme",
  disbursements: "Disbursement",
  settlements: "Settlement",
  offers: "Offer",
  projects: "Project",
  documents: "Document",
  users: "User",
};

function isRecordId(segment: string): boolean {
  return /^[a-z0-9]{16,}$/i.test(segment) || /^[0-9a-f-]{20,}$/i.test(segment) || /^\d+$/.test(segment);
}

function humanise(segment: string, parent?: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  if (isRecordId(segment)) {
    if (parent && RECORD_LABELS[parent]) return RECORD_LABELS[parent];
    if (parent && parent.length > 3 && parent.endsWith("s")) return humanise(parent.slice(0, -1));
    return "Details";
  }
  return segment.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

type PageLabel = { pathname: string; label: string } | null;

const BreadcrumbLabelContext = createContext<{ value: PageLabel; set: (value: PageLabel) => void } | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [value, set] = useState<PageLabel>(null);
  return <BreadcrumbLabelContext.Provider value={{ value, set }}>{children}</BreadcrumbLabelContext.Provider>;
}

/**
 * Renders nothing; names the current page's last breadcrumb, e.g. `<BreadcrumbLabel label={invoice.number} />`.
 * Can be rendered from a server page. The label applies only to the pathname it was set on.
 */
export function BreadcrumbLabel({ label }: { label: string }) {
  const set = useContext(BreadcrumbLabelContext)?.set;
  const pathname = usePathname();
  useEffect(() => {
    if (!set) return;
    set({ pathname, label });
    return () => set(null);
  }, [set, pathname, label]);
  return null;
}

/** Workspace eyebrow plus a trail derived from the navigation map: Section › Record. */
export function Breadcrumbs({ workspace, className }: { workspace: WorkspaceKey; className?: string }) {
  const pathname = usePathname();
  const pageLabel = useContext(BreadcrumbLabelContext)?.value;
  const items = NAVIGATION[workspace].flatMap((s) => s.items);
  const currentHref = activeHref(pathname, items);
  const current = items.find((i) => i.href === currentHref);
  const crumbs: { label: string; href?: string }[] = [];
  if (current) {
    crumbs.push({ label: current.title, href: current.href });
    const rest = pathname.slice(current.href.length).split("/").filter(Boolean);
    const parents = [current.href.split("/").filter(Boolean).pop(), ...rest];
    rest.forEach((segment, i) => {
      crumbs.push({ label: humanise(segment, parents[i]), href: `${current.href}/${rest.slice(0, i + 1).join("/")}` });
    });
  } else {
    const segments = pathname.split("/").filter(Boolean);
    crumbs.push({ label: segments.length ? humanise(segments[segments.length - 1], segments[segments.length - 2]) : "Overview" });
  }
  if (pageLabel?.pathname === pathname && crumbs.length > 0) {
    crumbs[crumbs.length - 1] = { ...crumbs[crumbs.length - 1], label: pageLabel.label };
  }

  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow hidden truncate text-[0.625rem] tracking-[0.2em] text-kota-700 sm:block">{WORKSPACES[workspace].label}</p>
      <nav aria-label="Breadcrumb" className="mt-0.5">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${crumb.label}-${i}`} className={cn("flex min-w-0 items-center gap-1.5", !last && "hidden sm:flex")}>
                {i > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-paper-400" />}
                {last || !crumb.href ? (
                  <span aria-current={last ? "page" : undefined} className="truncate font-medium text-basalt">
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} className="truncate text-muted-foreground transition-colors hover:text-basalt">
                    {crumb.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
