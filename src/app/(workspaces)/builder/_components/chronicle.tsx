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
  basalt: "bg-basalt text-kota ring-basalt/10",
  leaf: "bg-leaf text-white ring-leaf/15",
  kota: "bg-kota-100 text-kota-600 ring-kota/35",
  amber: "bg-[#fbf1df] text-[#8a5a12] ring-[#e3ddd2]",
  rose: "bg-[#f9e6ea] text-[#8a1f37] ring-[#efc6cf]",
  muted: "bg-paper text-ink/70 ring-[#dfe2de]",
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
            {!last && <span aria-hidden="true" className="absolute top-8 bottom-1 left-[0.875rem] w-px -translate-x-1/2 bg-[#dfe2de]" />}
            <span className={cn("relative z-10 flex size-7 items-center justify-center rounded-full ring-4", NODE[entry.tone ?? "muted"])}>
              <Icon className="size-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[0.875rem] leading-snug font-medium text-basalt">{entry.title}</p>
              {entry.when && <p className="tabular mt-1 text-[0.6875rem] tracking-[0.04em] text-kota-600">{entry.when}</p>}
              {entry.meta && <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">{entry.meta}</p>}
              {entry.body && (
                <blockquote className="mt-2.5 border-l-2 border-kota/60 pl-3.5 font-display text-[1.0625rem] leading-snug text-ink italic">{entry.body}</blockquote>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
