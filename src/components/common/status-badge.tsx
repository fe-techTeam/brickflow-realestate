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
  neutral: "bg-paper-100 text-ink-soft ring-paper-300",
  info: "bg-info-soft text-info ring-[#cddcea]",
  basalt: "bg-basalt-50 text-basalt ring-basalt-200",
  warning: "bg-warning-soft text-warning ring-[#e3ddd2]",
  success: "bg-leaf-50 text-leaf ring-leaf-200",
  danger: "bg-danger-soft text-danger ring-[#efc6cf]",
  kota: "bg-kota-50 text-kota-700 ring-kota-300/70",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-ink/35",
  info: "bg-info",
  basalt: "bg-basalt",
  warning: "bg-[#c48a2c]",
  success: "bg-leaf-500",
  danger: "bg-danger",
  kota: "bg-kota",
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
        "inline-flex h-[1.375rem] items-center gap-1.5 rounded-full pr-2.5 pl-2 text-[0.6875rem] leading-none font-medium tracking-[0.01em] whitespace-nowrap ring-1 ring-inset",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[meta.tone])} />
      {meta.label}
    </span>
  );
}

export function StatusBadge<K extends StatusKind>({ kind, status, className }: { kind: K; status: keyof Registry[K]; className?: string }) {
  const meta = (REGISTRY[kind] as Record<string, StatusMeta>)[status as string] ?? { label: String(status), tone: "neutral" as const };
  return <ToneBadge meta={meta} className={className} />;
}

export function DemoBadge({ className }: { className?: string }) {
  return <ToneBadge meta={{ label: "Simulated", tone: "kota" }} className={className} />;
}
