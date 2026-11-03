import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import type { WorkspaceKey } from "@/lib/workspaces";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

export interface ShellUser {
  name: string;
  email: string;
  orgName: string;
  designation: string | null;
}

const TODAY = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

function DemoBanner({ text }: { text: string }) {
  return (
    <div className="relative flex min-h-8 items-center justify-center gap-2.5 bg-navy-950 px-4 py-1.5 text-center text-[0.6875rem] tracking-[0.01em] text-white/70">
      <span className="inline-flex h-[1.125rem] shrink-0 items-center rounded-full border border-gold/45 px-2 text-[0.5625rem] font-semibold tracking-[0.2em] text-gold-300 uppercase">
        Demo
      </span>
      <span className="min-w-0">{text}</span>
      <span aria-hidden="true" className="gold-rule-center absolute inset-x-0 bottom-0 opacity-40" />
    </div>
  );
}

export function AppShell({
  workspace,
  user,
  banner,
  children,
  sidebarCollapsed = false,
}: {
  workspace: WorkspaceKey;
  user: ShellUser;
  banner: string;
  children: ReactNode;
  sidebarCollapsed?: boolean;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar workspace={workspace} orgName={user.orgName} defaultCollapsed={sidebarCollapsed} />

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner text={banner} />
        <header className="sticky top-0 z-30 border-b hairline bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-16 w-full max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-10">
            <MobileNav workspace={workspace} orgName={user.orgName} />
            <Breadcrumbs workspace={workspace} className="flex-1" />
            <p className="kicker hidden text-[0.95rem] whitespace-nowrap text-slate-ink-soft xl:block">{TODAY.format(new Date())}</p>
            <span aria-hidden="true" className="mx-2 hidden h-7 w-px bg-border xl:block" />
            <UserMenu user={user} workspace={workspace} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-11">{children}</main>
        <footer className="border-t hairline">
          <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-2 px-4 py-6 text-[0.6875rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
            <p className="flex items-center gap-2.5">
              <LogoMark className="size-5" />
              <span className="font-medium text-slate-ink">BrickFlow</span>
              <span aria-hidden="true" className="h-3 w-px bg-border" />
              <span>Real Estate Receivables, Made Liquid</span>
            </p>
            <p>Demonstration build · fictional organisations · simulated payments</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
