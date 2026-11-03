import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortDirection, SortState } from "@/components/common/data-table";
import { cn } from "@/lib/utils";
import type { SearchParams } from "../_lib/params";

type Align = "left" | "right" | "center";

/** Ledger-style table: no header fill, hairline rules, generous row height, horizontal scroll on small screens. */
export function Ledger({ children, minWidth = 900, caption }: { children: ReactNode; minWidth?: number; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[0.8125rem]" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

const cellPad = "px-3 first:pl-5 last:pr-5 xl:px-3.5 sm:first:pl-7 sm:last:pr-7";

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: Align; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        cellPad,
        "border-b border-[#e7e1d3] bg-[#fbfaf6] py-3 text-[0.625rem] font-semibold tracking-[0.16em] whitespace-nowrap text-muted-foreground uppercase",
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
        cellPad,
        "border-b border-[#f0ebe0] py-4 align-middle text-slate-ink",
        align === "right" && "tabular text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("transition-colors last:[&>td]:border-b-0 hover:bg-[#fbf9f4]", className)}>{children}</tr>;
}

/** Sortable header that toggles ?sort/&dir while preserving other params. */
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
  searchParams: SearchParams;
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
        aria-label={`Sort by ${label}`}
        className={cn("group/sort inline-flex items-center gap-1.5 transition-colors hover:text-navy", active && "text-navy", align === "right" && "flex-row-reverse")}
      >
        {label}
        <Icon className={cn("size-3", active ? "text-gold-600" : "opacity-40 group-hover/sort:opacity-80")} />
      </Link>
    </Th>
  );
}

/** Full-bleed filter strip at the top of a flush Panel. */
export function TableToolbar({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#efe9dc] bg-[#fdfcf9] px-5 py-4 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">{children}</div>
      {aside && <div className="shrink-0 text-[0.75rem] text-muted-foreground">{aside}</div>}
    </div>
  );
}

/** Link styled as the primary identifier of a row. */
export function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("font-medium text-navy decoration-gold/60 underline-offset-[5px] hover:underline", className)}>
      {children}
    </Link>
  );
}

export function Ref({ children }: { children: ReactNode }) {
  return <p className="mt-1 font-mono text-[0.6875rem] tracking-tight text-muted-foreground">{children}</p>;
}
