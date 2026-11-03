"use client";

import { useState } from "react";
import { ChevronsLeft } from "lucide-react";
import { LogoMark, Logo } from "@/components/brand/logo";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { SIDEBAR_COOKIE } from "./navigation";
import { SidebarNav } from "./sidebar-nav";



/** Faint stone elevation drawing anchored to the bottom of the basalt panels. */
export function SidebarSkyline({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 272 180" preserveAspectRatio="xMidYMax slice" className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-44 w-full text-fg-muted", className)} fill="none">
      <g stroke="currentColor" strokeOpacity="0.16" strokeWidth="1">
        <path d="M18 180V118h34v62M60 180V64h40v116M108 180V96h30v84M146 180V40h44v140M198 180V104h32v76M238 180V82h30v98" />
      </g>
      <g stroke="currentColor" strokeOpacity="0.09" strokeWidth="0.75">
        <path d="M60 80h40M60 96h40M60 112h40M60 128h40M60 144h40M60 160h40M146 56h44M146 72h44M146 88h44M146 104h44M146 120h44M146 136h44M146 152h44M146 168h44M238 98h30M238 114h30M238 130h30M238 146h30M238 162h30" />
        <path d="M80 64v116M161 40v140M175 40v140" />
      </g>
    </svg>
  );
}

export function OrgCard({ orgName, workspace, collapsed = false }: { orgName: string; workspace: WorkspaceKey; collapsed?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-xl border border-white/[0.08] bg-night-deep/35 p-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur-sm",
        collapsed && "justify-center border-transparent bg-transparent p-0 shadow-none",
      )}
      title={collapsed ? orgName : undefined}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-night to-night-deep font-display text-[0.8125rem] font-normal text-fg-muted ring-1 ring-line-strong/35">
        {initials(orgName)}
      </span>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] leading-tight font-medium text-white/90">{orgName}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] leading-none text-white/45">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-leaf-300 shadow-[0_0_0_3px_rgb(140_187_151/0.15)]" />
            {WORKSPACES[workspace].shortLabel}
          </p>
        </div>
      )}
    </div>
  );
}

export function SidebarBrand({ workspace, collapsed = false }: { workspace: WorkspaceKey; collapsed?: boolean }) {
  return (
    <div className={cn("transition-[padding] duration-300", collapsed ? "px-0" : "px-1")}>
      {collapsed ? <LogoMark className="mx-auto size-9" /> : <Logo tone="light" />}
      <div className={cn("mt-5 flex items-center gap-2.5", collapsed && "justify-center")}>
        <span aria-hidden="true" className={cn("h-px bg-haze/70", collapsed ? "w-5" : "w-5")} />
        {!collapsed && <p className="text-[0.625rem] font-semibold tracking-[0.24em] whitespace-nowrap text-fg-muted/90 uppercase">{WORKSPACES[workspace].label}</p>}
      </div>
    </div>
  );
}

export function Sidebar({ workspace, orgName, defaultCollapsed = false }: { workspace: WorkspaceKey; orgName: string; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "group/sidebar sticky top-0 z-40 hidden h-screen shrink-0 flex-col text-sidebar-foreground transition-[width] duration-300 ease-out-soft lg:flex",
        collapsed ? "w-[4.75rem]" : "w-[17rem]",
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <SidebarSkyline />
      </div>

      <div className={cn("relative px-5 pt-7 pb-6", collapsed && "px-3")}>
        <SidebarBrand workspace={workspace} collapsed={collapsed} />
      </div>

      <div className={cn("relative flex-1 overflow-x-hidden overflow-y-auto px-3 pb-6 [scrollbar-color:rgb(255_255_255/0.12)_transparent]", collapsed && "px-3.5")}>
        <SidebarNav workspace={workspace} collapsed={collapsed} />
      </div>

      <div className={cn("relative px-4 pb-5", collapsed && "px-3")}>
        <OrgCard orgName={orgName} workspace={workspace} collapsed={collapsed} />
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        className="absolute top-[5.25rem] -right-3 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-card text-fg opacity-0 shadow-raised transition-all duration-200 group-hover/sidebar:opacity-100 hover:border-line-strong/60 hover:text-fg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronsLeft className={cn("size-3.5 transition-transform duration-300", collapsed && "rotate-180")} />
      </button>
    </aside>
  );
}
