"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkspaceKey } from "@/lib/workspaces";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAVIGATION, type NavItem } from "./navigation";

export function activeHref(pathname: string, items: NavItem[]): string | null {
  const matches = items.filter((item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

export function SidebarNav({ workspace, onNavigate, collapsed = false }: { workspace: WorkspaceKey; onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const sections = NAVIGATION[workspace];
  const current = activeHref(pathname, sections.flatMap((s) => s.items));

  return (
    <nav aria-label="Workspace navigation" className="flex flex-col gap-7">
      {sections.map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-1">
          {section.label && (
            <div className={cn("mb-1.5 flex h-3 items-center gap-2.5 px-3 transition-opacity duration-300", collapsed && "justify-center px-0")}>
              {collapsed ? (
                <span aria-hidden="true" className="h-px w-4 bg-haze/35" />
              ) : (
                <>
                  <p className="text-[0.625rem] font-semibold tracking-[0.22em] whitespace-nowrap text-white/38 uppercase">{section.label}</p>
                  <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-white/10 to-white/0" />
                </>
              )}
            </div>
          )}
          {section.items.map((item) => {
            const active = item.href === current;
            const Icon = item.icon;
            const link = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? item.title : undefined}
                className={cn(
                  "group/nav relative flex h-10 items-center gap-3 rounded-lg px-3 text-[0.8125rem] font-medium tracking-[0.005em] transition-[background-color,color,box-shadow] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-line-strong/60",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-gradient-to-r from-white/[0.10] to-white/[0.025] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
                    : "text-white/65 hover:bg-card/[0.045] hover:text-white",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-2.5 bottom-2.5 left-0 w-[2px] rounded-full bg-signal-400 transition-all duration-300",
                    active ? "opacity-100" : "scale-y-0 opacity-0",
                  )}
                />
                <Icon
                  className={cn("size-[1.05rem] shrink-0 transition-colors duration-200", active ? "text-signal-300" : "text-white/40 group-hover/nav:text-white/75")}
                  strokeWidth={1.6}
                />
                {!collapsed && <span className="truncate">{item.title}</span>}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {item.title}
                </TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}
