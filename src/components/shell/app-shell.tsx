import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { Logo } from "@/components/brand/logo";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export interface ShellUser {
  name: string;
  email: string;
  orgName: string;
  designation: string | null;
}

export function AppShell({ workspace, user, banner, children }: { workspace: WorkspaceKey; user: ShellUser; banner: string; children: ReactNode }) {
  const definition = WORKSPACES[workspace];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="px-5 pt-6 pb-5">
          <Logo tone="light" />
          <p className="mt-4 text-[0.625rem] font-semibold tracking-[0.2em] text-gold/90 uppercase">{definition.label}</p>
        </div>
        <div className="mx-5 h-px bg-white/10" />
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <SidebarNav workspace={workspace} />
        </div>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-xs font-medium text-white/80">{user.orgName}</p>
          <p className="mt-0.5 text-[0.6875rem] text-white/40">Demo workspace</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-center gap-2 bg-navy-900 px-4 py-1.5 text-center text-[0.6875rem] font-medium tracking-wide text-gold">
          <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{banner}</span>
        </div>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/80 bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-6 lg:px-10">
          <MobileNav workspace={workspace} orgName={user.orgName} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow truncate">{definition.shortLabel}</p>
            <p className="truncate text-sm font-medium text-navy">{user.orgName}</p>
          </div>
          <UserMenu user={user} />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
        <footer className="border-t border-border/70 px-4 py-5 text-[0.6875rem] text-muted-foreground sm:px-6 lg:px-10">
          BrickFlow · Real Estate Receivables, Made Liquid · Demonstration build — fictional organisations, simulated payments.
        </footer>
      </div>
    </div>
  );
}
