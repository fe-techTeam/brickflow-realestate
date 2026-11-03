import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChronicleTone = "basalt" | "leaf" | "kota" | "amber" | "rose" | "muted";

export interface ChronicleEntry {
  id: string;
  icon: LucideIcon;
  tone?: ChronicleTone;
  title: ReactNode;
  meta?: ReactNode;
  when?: ReactNode;
  body?: ReactNode;
}

const NODE: Record<ChronicleTone, string> = {
  basalt: "bg-night text-fg-muted ring-line-strong/10",
  leaf: "bg-leaf text-white ring-leaf/15",
  kota: "bg-glass-100 text-fg-muted ring-line-strong/35",
  amber: "bg-[rgba(255,179,107,0.14)] text-[#ffb36b] ring-[rgba(255,255,255,0.08)]",
  rose: "bg-[rgba(255,123,110,0.14)] text-[#ff8c80] ring-[rgba(255,123,110,0.3)]",
  muted: "bg-glass text-fg-soft/70 ring-[rgba(255,255,255,0.1)]",
};

/** Vertical history with iconographic nodes; quoted notes are set in the serif face. */
export function Chronicle({ entries, className }: { entries: ChronicleEntry[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {entries.map((entry, index) => {
        const Icon = entry.icon;
        const last = index === entries.length - 1;
        return (
          <li key={entry.id} className={cn("relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4", !last && "pb-6")}>
            {!last && <span aria-hidden="true" className="absolute top-8 bottom-1 left-[0.875rem] w-px -translate-x-1/2 bg-[rgba(255,255,255,0.1)]" />}
            <span className={cn("relative z-10 flex size-7 items-center justify-center rounded-full ring-4", NODE[entry.tone ?? "muted"])}>
              <Icon className="size-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[0.875rem] leading-snug font-medium text-fg">{entry.title}</p>
              {entry.when && <p className="tabular mt-1 text-[0.6875rem] tracking-[0.04em] text-fg-muted">{entry.when}</p>}
              {entry.meta && <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">{entry.meta}</p>}
              {entry.body && (
                <blockquote className="mt-2.5 border-l-2 border-line-strong/60 pl-3.5 font-display text-[1.0625rem] leading-snug text-fg-soft italic">{entry.body}</blockquote>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
