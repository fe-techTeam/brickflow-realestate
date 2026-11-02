import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Table frame with horizontal scroll on small screens. Use with the th/td helpers below. */
export function DataTable({ children, className, minWidth = 880 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto sm:-mx-6", className)}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border bg-ivory/60 px-4 py-2.5 text-[0.6875rem] font-semibold tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
        align === "left" && "text-left",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <td
      className={cn(
        "border-b border-border/70 px-4 py-3.5 align-middle text-slate-ink first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
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
  return <tr className={cn("transition-colors last:[&>td]:border-b-0 hover:bg-ivory/50", className)}>{children}</tr>;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDirection;
}

/** Reads ?sort=key&dir=asc|desc with a fallback default. */
export function readSort(searchParams: Record<string, string | string[] | undefined>, allowed: readonly string[], fallback: SortState): SortState {
  const key = typeof searchParams.sort === "string" && allowed.includes(searchParams.sort) ? searchParams.sort : fallback.key;
  const dir = searchParams.dir === "asc" || searchParams.dir === "desc" ? searchParams.dir : fallback.dir;
  return { key, dir };
}

export function sortRows<T>(rows: T[], sort: SortState, accessors: Record<string, (row: T) => string | number | bigint | Date | null | undefined>): T[] {
  const get = accessors[sort.key];
  if (!get) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const left = av instanceof Date ? av.getTime() : av;
    const right = bv instanceof Date ? bv.getTime() : bv;
    if (typeof left === "string" && typeof right === "string") return left.localeCompare(right) * factor;
    return (left < right ? -1 : 1) * factor;
  });
}

/** Sortable column header that toggles ?sort/&dir while preserving other params. */
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
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th align={align}>
      <Link
        href={`${pathname}?${params.toString()}`}
        scroll={false}
        className={cn("inline-flex items-center gap-1 hover:text-navy", active && "text-navy")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="size-3" />
      </Link>
    </Th>
  );
}
