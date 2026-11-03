"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { NAVIGATION } from "./navigation";
import { activeHref } from "./sidebar-nav";

const SEGMENT_LABELS: Record<string, string> = { new: "New", edit: "Edit" };

function humanise(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  if (/^[a-z0-9]{16,}$/i.test(segment) || /^[0-9a-f-]{20,}$/i.test(segment)) return "Details";
  return segment.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Workspace eyebrow plus a trail derived from the navigation map: Section › Details. */
export function Breadcrumbs({ workspace, className }: { workspace: WorkspaceKey; className?: string }) {
  const pathname = usePathname();
  const items = NAVIGATION[workspace].flatMap((s) => s.items);
  const currentHref = activeHref(pathname, items);
  const current = items.find((i) => i.href === currentHref);
  const crumbs: { label: string; href?: string }[] = [];
  if (current) {
    crumbs.push({ label: current.title, href: current.href });
    const rest = pathname.slice(current.href.length).split("/").filter(Boolean);
    rest.forEach((segment, i) => {
      crumbs.push({ label: humanise(segment), href: `${current.href}/${rest.slice(0, i + 1).join("/")}` });
    });
  } else {
    crumbs.push({ label: humanise(pathname.split("/").filter(Boolean).pop() ?? "Overview") });
  }

  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow hidden truncate text-[0.625rem] tracking-[0.2em] text-gold-700 sm:block">{WORKSPACES[workspace].label}</p>
      <nav aria-label="Breadcrumb" className="mt-0.5">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${crumb.label}-${i}`} className={cn("flex min-w-0 items-center gap-1.5", !last && "hidden sm:flex")}>
                {i > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ivory-400" />}
                {last || !crumb.href ? (
                  <span aria-current={last ? "page" : undefined} className="truncate font-medium text-navy">
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} className="truncate text-muted-foreground transition-colors hover:text-navy">
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
