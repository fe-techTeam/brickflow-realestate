import type { ReactNode } from "react";
import Link from "next/link";
import type { ProgrammeStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { PROGRAMME_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

function Guilloche({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn("pointer-events-none absolute text-gold/[0.12]", className)} viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="0.5">
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx="100" cy="100" r={18 + i * 7} />
      ))}
    </svg>
  );
}

const STATUS_TEXT: Record<ProgrammeStatus, string> = {
  ACTIVE: "text-[#9fd3bd]",
  DRAFT: "text-white/60",
  SUSPENDED: "text-[#efc979]",
  CLOSED: "text-[#e7a497]",
};

/** Programme presented as a facility certificate: code, name, the agreed rate and its validity. */
export function FacilityCard({
  code,
  name,
  rateBps,
  status,
  builder,
  effectiveFrom,
  effectiveTo,
  offerValidityDays,
  footer,
  className,
}: {
  code: string;
  name: string;
  rateBps: number;
  status: ProgrammeStatus;
  builder?: { id: string; name: string };
  effectiveFrom: Date;
  effectiveTo: Date | null;
  offerValidityDays: number;
  footer?: ReactNode;
  className?: string;
}) {
  const rate = formatBps(rateBps, { suffix: false });
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-navy text-white shadow-[0_24px_48px_-28px_rgba(13,30,48,0.7)]", className)}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" />
      <Guilloche className="-top-20 -right-20 size-72" />
      <div className="relative p-6 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <p className="tabular text-[0.625rem] font-semibold tracking-[0.22em] text-gold uppercase">{code}</p>
          <span className={cn("flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.18em] uppercase", STATUS_TEXT[status])}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {PROGRAMME_STATUS[status].label}
          </span>
        </div>
        <p className="mt-3 font-display text-[1.375rem] leading-snug font-medium text-white">{name}</p>
        {builder && (
          <Link href={`/finance/builders/${builder.id}`} className="mt-1 inline-block text-sm text-white/65 underline-offset-4 hover:text-white hover:underline">
            {builder.name}
          </Link>
        )}
        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-white/50 uppercase">Agreed discount</p>
            <p className="tabular mt-2 font-sans text-[3.25rem] leading-none font-extralight tracking-[-0.03em] text-white">
              {rate}
              <span className="ml-1 align-[0.6em] text-[0.4em] font-normal text-gold">%</span>
            </p>
          </div>
          <dl className="grid gap-2 text-right text-xs">
            <div>
              <dt className="text-white/45">Effective</dt>
              <dd className="tabular text-white/85">
                {formatDate(effectiveFrom)} – {effectiveTo ? formatDate(effectiveTo) : "open"}
              </dd>
            </div>
            <div>
              <dt className="text-white/45">Offer validity</dt>
              <dd className="tabular text-white/85">
                {offerValidityDays} day{offerValidityDays === 1 ? "" : "s"}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      {footer && <div className="relative border-t border-white/10 bg-navy-900/40 px-6 py-4 text-xs text-white/65 sm:px-7">{footer}</div>}
    </div>
  );
}

/** Payout account presented as a private-banking card; the number is already masked. */
export function PayoutCard({ bankName, accountMasked, ifsc, holder }: { bankName: string | null; accountMasked: string; ifsc: string | null; holder: string }) {
  const grouped = accountMasked.replace(/(.{4})(?=.)/g, "$1 ");
  return (
    <div className="relative aspect-[1.7/1] max-w-md overflow-hidden rounded-xl bg-[linear-gradient(135deg,#142b43_0%,#1d3a57_55%,#174d3c_120%)] p-6 text-white shadow-[0_28px_56px_-30px_rgba(13,30,48,0.75)]">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" />
      <Guilloche className="-right-24 -bottom-28 size-80" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-gold uppercase">Payout account</p>
          <p className="max-w-[60%] truncate text-right text-xs text-white/70">{bankName ?? "Bank not set"}</p>
        </div>
        <span aria-hidden="true" className="block h-8 w-11 rounded-md bg-[linear-gradient(135deg,#e2cb9b,#a98a52)] opacity-90" />
        <div>
          <p className="tabular font-sans text-[1.375rem] font-light tracking-[0.18em] text-white">{grouped}</p>
          <div className="mt-3 flex items-end justify-between gap-3 text-[0.6875rem]">
            <div className="min-w-0">
              <p className="text-white/45 uppercase">Account holder</p>
              <p className="truncate font-medium text-white/90">{holder}</p>
            </div>
            <div className="text-right">
              <p className="text-white/45 uppercase">IFSC</p>
              <p className="tabular font-medium text-white/90">{ifsc ?? "—"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
