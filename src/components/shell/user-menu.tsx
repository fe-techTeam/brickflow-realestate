"use client";

import { useTransition } from "react";
import { Building2, ChevronDown, LogOut, Mail } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { logoutAction } from "@/server/actions/auth";
import type { ShellUser } from "./app-shell";

export function UserMenu({ user, workspace }: { user: ShellUser; workspace?: WorkspaceKey }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group/user flex items-center gap-3 rounded-lg py-1.5 pr-2 pl-1.5 text-left transition-colors outline-none hover:bg-paper-200/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-paper-200/60 sm:pl-3"
        aria-label="Account menu"
      >
        <div className="hidden text-right sm:block">
          <p className="text-[0.8125rem] leading-tight font-medium text-basalt">{user.name}</p>
          <p className="mt-0.5 text-[0.6875rem] leading-tight text-muted-foreground">{user.designation ?? user.email}</p>
        </div>
        <Avatar className="size-9 ring-1 ring-kota/50 ring-offset-2 ring-offset-background after:hidden">
          <AvatarFallback className="bg-gradient-to-b from-basalt-700 to-basalt-900 text-[0.75rem] font-semibold tracking-wide text-kota-300">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <ChevronDown className="hidden size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]/user:rotate-180 sm:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-72 p-0">
        <DropdownMenuLabel className="relative overflow-hidden rounded-t-[inherit] bg-basalt bg-[linear-gradient(160deg,#283431_0%,#222d2b_55%,#111816_100%)] px-4 py-4 font-normal">
          <div className="flex items-center gap-3">
            <Avatar className="size-11 ring-1 ring-kota/50 after:hidden">
              <AvatarFallback className="bg-basalt-900 text-sm font-semibold text-kota-300">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-medium text-white">{user.name}</p>
              <p className="truncate text-xs text-white/60">{user.designation ?? (workspace ? WORKSPACES[workspace].shortLabel : "")}</p>
            </div>
          </div>
          <span aria-hidden="true" className="kota-rule-center absolute inset-x-0 bottom-0 opacity-60" />
        </DropdownMenuLabel>
        <div className="space-y-2.5 px-4 py-3.5 text-xs text-ink">
          <p className="flex items-center gap-2.5">
            <Mail className="size-3.5 text-kota-600" strokeWidth={1.75} />
            <span className="truncate">{user.email}</span>
          </p>
          <p className="flex items-center gap-2.5">
            <Building2 className="size-3.5 text-kota-600" strokeWidth={1.75} />
            <span className="truncate">{user.orgName}</span>
          </p>
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1.5">
          <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => startTransition(() => logoutAction())}>
            <LogOut className="size-4" />
            {pending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
