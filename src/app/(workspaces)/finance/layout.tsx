import type { ReactNode } from "react";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";

export default function Layout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout workspace="finance">{children}</WorkspaceLayout>;
}
