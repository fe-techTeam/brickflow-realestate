import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortState } from "@/components/common/data-table";
import { cn } from "@/lib/utils";

type Align = "left" | "right" | "center";

/** Edge shadows appear only while columns are hidden: the white covers scroll with the content, the shades stay put. */
const SCROLL_SHADOWS = {
  background: [
    "linear-gradient(to right, var(--color-card, #fff) 40%, transparent) left / 48px 100% no-repeat local",
    "linear-gradient(to left, var(--color-card, #fff) 40%, transparent) right / 48px 100% no-repeat local",
    "radial-gradient(farthest-side at 0 50%, rgba(20, 43, 67, 0.14), transparent) left / 16px 100% no-repeat scroll",
    "radial-gradient(farthest-side at 100% 50%, rgba(20, 43, 67, 0.14), transparent) right / 16px 100% no-repeat scroll",
  ].join(", "),
};

/** Refined table frame: no header fill, hairline rules, generous rows; scrolls horizontally on small screens. */
export function Ledger({ children, minWidth = 880, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto sm:-mx-7", className)} style={SCROLL_SHADOWS}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

const cellPad = "px-4 first:pl-5 last:pr-5 sm:first:pl-7 sm:last:pr-7";

export function LTh({ children, align = "left", className }: { children?: ReactNode; align?: Align; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        cellPad,
        "border-y border-border/90 bg-ivory/40 py-3 text-[0.625rem] font-semibold tracking-[0.16em] whitespace-nowrap text-muted-foreground uppercase",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
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
        cellPad,
        "border-b border-border/60 py-4 align-middle text-slate-ink",
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
  return <tr className={cn("group/row transition-colors last:[&>td]:border-b-0 hover:bg-ivory/45", className)}>{children}</tr>;
}

/** Sortable ledger header that toggles ?sort/&dir while preserving other params. */
export function LSortTh({
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
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "sort" && k !== "dir") params.set(k, v);
  params.set("sort", sortKey);
  params.set("dir", active && sort.dir === "desc" ? "asc" : "desc");
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <LTh align={align}>
      <Link
        href={`${pathname}?${params.toString()}`}
        scroll={false}
        aria-label={`Sort by ${label}`}
        className={cn("inline-flex items-center gap-1.5 transition-colors hover:text-navy", active && "text-navy")}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-50")} />
      </Link>
    </LTh>
  );
}

/** Mono reference code in navy, e.g. programme and request references. */
export function RefCode({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[0.75rem] font-medium tracking-tight whitespace-nowrap text-navy", className)}>{children}</span>;
}
