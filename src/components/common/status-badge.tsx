import { cn } from "@/lib/utils";
import {
  DISBURSEMENT_STATUS,
  FINANCING_STATUS,
  INVOICE_STATUS,
  OFFER_STATUS,
  PROGRAMME_STATUS,
  RECORD_STATUS,
  SETTLEMENT_STATUS,
  type StatusMeta,
  type StatusTone,
} from "@/lib/status";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-slate-ink/80 ring-border",
  info: "bg-[#e8eff6] text-[#25507a] ring-[#c9d9ea]",
  navy: "bg-navy/[0.07] text-navy ring-navy/15",
  warning: "bg-[#fbf1df] text-[#8a5a12] ring-[#efd9ae]",
  success: "bg-sage text-heritage ring-heritage/20",
  danger: "bg-[#f8e7e4] text-[#93342a] ring-[#ecc6bf]",
  gold: "bg-gold-100 text-gold-600 ring-gold/30",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-slate-ink/40",
  info: "bg-[#3b6ea0]",
  navy: "bg-navy",
  warning: "bg-[#c48a2c]",
  success: "bg-heritage",
  danger: "bg-[#b5473a]",
  gold: "bg-gold",
};

const REGISTRY = {
  invoice: INVOICE_STATUS,
  financing: FINANCING_STATUS,
  settlement: SETTLEMENT_STATUS,
  programme: PROGRAMME_STATUS,
  offer: OFFER_STATUS,
  disbursement: DISBURSEMENT_STATUS,
  record: RECORD_STATUS,
} as const;

type Registry = typeof REGISTRY;
export type StatusKind = keyof Registry;

export function ToneBadge({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap ring-1 ring-inset",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_CLASSES[meta.tone])} />
      {meta.label}
    </span>
  );
}

export function StatusBadge<K extends StatusKind>({ kind, status, className }: { kind: K; status: keyof Registry[K]; className?: string }) {
  const meta = (REGISTRY[kind] as Record<string, StatusMeta>)[status as string] ?? { label: String(status), tone: "neutral" as const };
  return <ToneBadge meta={meta} className={className} />;
}

export function DemoBadge({ className }: { className?: string }) {
  return <ToneBadge meta={{ label: "Simulated", tone: "gold" }} className={className} />;
}
