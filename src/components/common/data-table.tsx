import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Table frame with horizontal scroll on small screens. Use with the Th/Td/Tr helpers below.
 * Bleeds to the edges of a Section body. `zebra` tints alternate rows; `dense` tightens row height.
 */
export function DataTable({
  children,
  className,
  minWidth = 880,
  zebra = false,
  dense = false,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: number;
  zebra?: boolean;
  dense?: boolean;
}) {
  return (
    <div className={cn("-mx-5 overflow-x-auto sm:-mx-6", className)}>
      <table
        data-zebra={zebra || undefined}
        data-dense={dense || undefined}
        className="group/table w-full border-separate border-spacing-0 text-sm"
        style={{ minWidth }}
      >
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
        "border-b border-border bg-paper-100 px-4 py-3 text-[0.65rem] font-semibold tracking-[0.11em] whitespace-nowrap text-ink-soft/85 uppercase first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
        "group-data-dense/table:py-2.5",
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
        "border-b hairline px-4 py-3.5 align-middle text-ink transition-[background-color,box-shadow] duration-200 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
        "group-data-dense/table:py-2.5",
        align === "right" && "figure text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={cn(
        "group/row last:[&>td]:border-b-0 group-data-zebra/table:even:[&>td]:bg-paper-100/60 hover:[&>td]:bg-kota-50 hover:[&>td:first-child]:shadow-[inset_2px_0_0_var(--color-kota)]",
        className,
      )}
    >
      {children}
    </tr>
  );
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
        className={cn("inline-flex items-center gap-1.5 transition-colors hover:text-basalt", active && "text-basalt")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className={cn("size-3", active ? "text-kota-600" : "opacity-50")} />
      </Link>
    </Th>
  );
}
