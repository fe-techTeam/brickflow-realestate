"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/brand/logo";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ workspace, orgName }: { workspace: WorkspaceKey; orgName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-none bg-sidebar p-0 text-sidebar-foreground">
        <SheetHeader className="px-5 pt-6 pb-4">
          <SheetTitle asChild>
            <div>
              <Logo tone="light" />
            </div>
          </SheetTitle>
          <SheetDescription className="text-[0.625rem] font-semibold tracking-[0.2em] text-gold uppercase">
            {WORKSPACES[workspace].label} · {orgName}
          </SheetDescription>
        </SheetHeader>
        <div className="px-3 pb-6">
          <SidebarNav workspace={workspace} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
