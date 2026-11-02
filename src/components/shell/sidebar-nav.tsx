"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkspaceKey } from "@/lib/workspaces";
import { cn } from "@/lib/utils";
import { NAVIGATION, type NavItem } from "./navigation";

function activeHref(pathname: string, items: NavItem[]): string | null {
  const matches = items.filter((item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

export function SidebarNav({ workspace, onNavigate }: { workspace: WorkspaceKey; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = NAVIGATION[workspace];
  const current = activeHref(pathname, sections.flatMap((s) => s.items));

  return (
    <nav aria-label="Workspace navigation" className="flex flex-col gap-6">
      {sections.map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-0.5">
          {section.label && <p className="mb-1.5 px-3 text-[0.625rem] font-semibold tracking-[0.18em] text-white/40 uppercase">{section.label}</p>}
          {section.items.map((item) => {
            const active = item.href === current;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.8125rem] font-medium transition-colors",
                  active ? "bg-white/[0.07] text-white" : "text-sidebar-foreground/75 hover:bg-white/[0.04] hover:text-white",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold transition-opacity", active ? "opacity-100" : "opacity-0")}
                />
                <Icon className={cn("size-4 shrink-0", active ? "text-gold" : "text-white/45 group-hover:text-white/70")} strokeWidth={1.75} />
                {item.title}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
