import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import type { WorkspaceKey } from "@/lib/workspaces";
import { BreadcrumbProvider, Breadcrumbs } from "./breadcrumbs";
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

export function AppShell({
  workspace,
  user,
  children,
  sidebarCollapsed = false,
  notifications,
}: {
  workspace: WorkspaceKey;
  user: ShellUser;
  children: ReactNode;
  sidebarCollapsed?: boolean;
  /** Top-bar notification control, rendered before the account menu. */
  notifications?: ReactNode;
}) {
  return (
    <BreadcrumbProvider>
      <div className="flex min-h-screen">
        <Sidebar workspace={workspace} orgName={user.orgName} defaultCollapsed={sidebarCollapsed} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b hairline bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
            <div className="mx-auto flex h-16 w-full max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-10">
              <MobileNav workspace={workspace} orgName={user.orgName} />
              <Breadcrumbs workspace={workspace} className="flex-1" />
              <p className="kicker hidden text-[0.95rem] whitespace-nowrap text-fg-muted xl:block">{TODAY.format(new Date())}</p>
              <span aria-hidden="true" className="mx-2 hidden h-7 w-px bg-border xl:block" />
              {notifications}
              <UserMenu user={user} workspace={workspace} />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-11">{children}</main>
          <footer className="border-t hairline">
            <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-2 px-4 py-6 text-[0.6875rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
              <p className="flex items-center gap-2.5">
                <LogoMark className="size-5" />
                <span className="font-medium text-fg-soft">BrickFlow</span>
                <span aria-hidden="true" className="h-3 w-px bg-border" />
                <span>Real Estate Receivables, Made Liquid</span>
              </p>
              <p>© {new Date().getFullYear()} BrickFlow</p>
            </div>
          </footer>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
