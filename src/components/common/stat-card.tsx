import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "navy",
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "navy" | "heritage" | "gold" | "slate";
  href?: string;
  className?: string;
}) {
  const toneClass = {
    navy: "text-navy bg-navy/[0.06]",
    heritage: "text-heritage bg-sage",
    gold: "text-gold-600 bg-gold-100",
    slate: "text-slate-ink bg-muted",
  }[tone];

  const body = (
    <div className={cn("surface group flex h-full flex-col gap-4 p-5 transition-shadow", href && "hover:shadow-[0_12px_32px_-16px_rgba(20,43,67,0.25)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow leading-snug">{label}</p>
        {Icon && (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", toneClass)}>
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        )}
      </div>
      <div className="mt-auto">
        <p className="tabular font-display text-[1.75rem] leading-none font-semibold text-navy">{value}</p>
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid animate-fade-up gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6", className)}>{children}</div>;
}
