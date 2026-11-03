import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortDirection, SortState } from "@/components/common/data-table";
import { cn } from "@/lib/utils";

type Align = "left" | "right" | "center";

/** Ledger-style table frame. Bleeds to the panel edges and scrolls horizontally on narrow screens. */
export function Table({ children, minWidth = 880, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto sm:-mx-7", className)}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

const edge = "first:pl-5 last:pr-5 sm:first:pl-7 sm:last:pr-7";

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: Align; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-y border-hairline bg-ivory-100 px-4 py-3 text-[0.625rem] font-semibold tracking-[0.16em] whitespace-nowrap text-muted-foreground uppercase",
        edge,
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className }: { children?: ReactNode; align?: Align; className?: string }) {
  return (
    <td
      className={cn(
        "border-b border-hairline px-4 py-4 align-middle text-slate-ink",
        edge,
        align === "right" && "text-right tabular",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("group/row transition-colors last:[&>td]:border-b-0 hover:bg-ivory-50", className)}>{children}</tr>;
}

/** Sortable header that toggles ?sort and &dir while preserving other params. */
export function SortTh({
  label,
  sortKey,
  sort,
  searchParams,
  pathname,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  searchParams: Record<string, string | string[] | undefined>;
  pathname: string;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const nextDir: SortDirection = active && sort.dir === "desc" ? "asc" : "desc";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "sort" && k !== "dir") params.set(k, v);
  params.set("sort", sortKey);
  params.set("dir", nextDir);
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th align={align}>
      <Link
        href={`${pathname}?${params.toString()}`}
        scroll={false}
        className={cn("inline-flex items-center gap-1 transition-colors hover:text-navy", active && "text-navy")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-50")} />
      </Link>
    </Th>
  );
}

/** Primary cell: linked reference with a muted secondary line. */
export function RefCell({ href, primary, secondary }: { href?: string; primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="min-w-0">
      {href ? (
        <Link href={href} className="font-medium whitespace-nowrap text-navy decoration-gold/60 underline-offset-4 hover:underline">
          {primary}
        </Link>
      ) : (
        <p className="font-medium whitespace-nowrap text-navy">{primary}</p>
      )}
      {secondary && <p className="mt-0.5 text-xs text-muted-foreground">{secondary}</p>}
    </div>
  );
}

/** Toolbar strip that sits between a panel header and its table. */
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="-mx-5 border-t border-hairline px-5 py-4 sm:-mx-7 sm:px-7">{children}</div>;
}
