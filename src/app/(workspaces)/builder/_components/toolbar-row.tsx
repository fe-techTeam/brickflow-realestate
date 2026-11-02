import type { ReactNode } from "react";

/** Full-bleed toolbar strip placed at the top of a Section body that holds a DataTable. */
export function ToolbarRow({ children }: { children: ReactNode }) {
  return <div className="-mx-5 border-b border-border/80 px-5 py-4 sm:-mx-6 sm:px-6">{children}</div>;
}
