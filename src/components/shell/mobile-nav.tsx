"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { OrgCard, SidebarBrand, SidebarSkyline } from "./sidebar";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ workspace, orgName }: { workspace: WorkspaceKey; orgName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="size-[1.1rem]" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(20rem,86vw)] overflow-hidden border-none bg-[#2b394c] p-0 text-sidebar-foreground [&>[data-slot=sheet-close]]:text-white/70 [&>[data-slot=sheet-close]]:hover:bg-card/10 [&>[data-slot=sheet-close]]:hover:text-white"
      >
        <SidebarSkyline />
        <SheetHeader className="relative px-6 pt-7 pb-5">
          <SheetTitle asChild>
            <div>
              <SidebarBrand workspace={workspace} />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">
            {WORKSPACES[workspace].label} navigation for {orgName}
          </SheetDescription>
        </SheetHeader>
        <div className="relative flex-1 overflow-y-auto px-4 pb-4">
          <SidebarNav workspace={workspace} onNavigate={() => setOpen(false)} />
        </div>
        <div className="relative px-4 pb-6">
          <OrgCard orgName={orgName} workspace={workspace} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
