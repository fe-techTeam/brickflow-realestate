import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortState } from "@/components/common/data-table";
import { cn } from "@/lib/utils";

type Align = "left" | "right" | "center";

/** Table frame that bleeds to the panel edges and scrolls horizontally on narrow screens. */
export function LedgerTable({ children, minWidth = 880, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto sm:-mx-7", className)}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

const edge = "first:pl-5 last:pr-5 sm:first:pl-7 sm:last:pr-7";

export function LTh({ children, align = "left", className }: { children?: ReactNode; align?: Align; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-y border-line-strong/10 bg-glass/45 px-3.5 py-3 text-[0.625rem] font-semibold tracking-[0.16em] whitespace-nowrap text-muted-foreground uppercase",
        edge,
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function LTd({ children, align = "left", className }: { children?: ReactNode; align?: Align; className?: string }) {
  return (
    <td
      className={cn(
        "border-b border-border/60 px-3.5 py-4 align-middle text-fg-soft",
        edge,
        align === "right" && "tabular text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function LTr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("transition-colors last:[&>td]:border-b-0 hover:bg-glass/40", className)}>{children}</tr>;
}

export function sortHref(searchParams: Record<string, string | string[] | undefined>, pathname: string, key: string, dir: "asc" | "desc") {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "sort" && k !== "dir") params.set(k, v);
  params.set("sort", key);
  params.set("dir", dir);
  return `${pathname}?${params.toString()}`;
}

export function LSortTh({
  label,
  sortKey,
  sort,
  searchParams,
  pathname,
  align = "left",
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  searchParams: Record<string, string | string[] | undefined>;
  pathname: string;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <LTh align={align} className={className}>
      <Link
        href={sortHref(searchParams, pathname, sortKey, active && sort.dir === "desc" ? "asc" : "desc")}
        scroll={false}
        className={cn("inline-flex items-center gap-1 transition-colors hover:text-fg", active && "text-fg")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-50")} />
      </Link>
    </LTh>
  );
}

/** Two-line cell: primary text over a quiet reference line. */
export function Stack({ primary, secondary, tertiary }: { primary: ReactNode; secondary?: ReactNode; tertiary?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-fg">{primary}</div>
      {secondary && <div className="mt-0.5 text-xs text-fg-soft/80">{secondary}</div>}
      {tertiary && <div className="tabular mt-0.5 text-[0.6875rem] tracking-wide text-muted-foreground">{tertiary}</div>}
    </div>
  );
}
