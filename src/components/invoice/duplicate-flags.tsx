"use client";

import Link from "next/link";
import { CheckCircle2, Copy, FileWarning, Fingerprint, Link2, ScanSearch, ShieldAlert, type LucideIcon } from "lucide-react";
import { ActionDialog } from "@/components/common/action-dialog";
import { Money } from "@/components/common/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { resolveDuplicateFlagAction } from "@/server/actions/invoices";

/** Serialisable view of a duplicate flag (see listDuplicateFlags / toDuplicateFlagDto). */
export interface DuplicateFlagDto {
  id: string;
  kind: "NEAR_DUPLICATE" | "SAME_IRN" | "SAME_DOCUMENT_OTHER_PARTNER" | "EXTERNAL_REGISTRY";
  status: "OPEN" | "CLEARED" | "CONFIRMED";
  detail: string;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  invoice: { id: string; reference: string; invoiceNumber: string; cpName: string; builderName: string; amountPaise: string };
  matched: { id: string; reference: string; invoiceNumber: string; cpName: string; builderName: string; amountPaise: string; invoiceDate: string; status: string } | null;
  matchedElsewhere: boolean;
  externalRef: string | null;
}

const KIND: Record<DuplicateFlagDto["kind"], { label: string; icon: LucideIcon }> = {
  NEAR_DUPLICATE: { label: "Same parties and amount", icon: Copy },
  SAME_IRN: { label: "Same e-invoice IRN", icon: Fingerprint },
  SAME_DOCUMENT_OTHER_PARTNER: { label: "Same PDF, different partner", icon: FileWarning },
  EXTERNAL_REGISTRY: { label: "Shared registry match", icon: ScanSearch },
};

const STATUS: Record<DuplicateFlagDto["status"], { label: string; className: string }> = {
  OPEN: { label: "Needs review", className: "border-warning/30 bg-warning-soft text-warning" },
  CLEARED: { label: "Not a duplicate", className: "border-leaf/25 bg-leaf-50 text-leaf" },
  CONFIRMED: { label: "Confirmed duplicate", className: "border-danger/30 bg-danger-soft text-danger" },
};

function FlagRow({ flag, canResolve, showInvoice, linkBase }: { flag: DuplicateFlagDto; canResolve: boolean; showInvoice: boolean; linkBase: string | null }) {
  const kind = KIND[flag.kind];
  const status = STATUS[flag.status];
  const Icon = kind.icon;
  return (
    <li className="px-5 py-4 sm:px-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-glass-100 text-fg-muted ring-1 ring-line">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {kind.label}
              <span className={cn("rounded-full border px-2 py-px text-[0.625rem] font-semibold tracking-[0.04em]", status.className)}>{status.label}</span>
            </p>
            {showInvoice && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {linkBase ? (
                  <Link href={`${linkBase}/${flag.invoice.id}`} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                    {flag.invoice.invoiceNumber}
                  </Link>
                ) : (
                  <span className="font-medium text-fg">{flag.invoice.invoiceNumber}</span>
                )}{" "}
                · {flag.invoice.cpName} → {flag.invoice.builderName} · <Money paise={flag.invoice.amountPaise} />
              </p>
            )}
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-soft">{flag.detail}</p>
            {flag.matched ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <Link2 className="size-3.5" />
                Matches{" "}
                {linkBase ? (
                  <Link href={`${linkBase}/${flag.matched.id}`} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                    {flag.matched.invoiceNumber}
                  </Link>
                ) : (
                  <span className="font-medium text-fg">{flag.matched.invoiceNumber}</span>
                )}
                <span className="font-mono">({flag.matched.reference})</span>· {flag.matched.cpName} · dated {formatDate(flag.matched.invoiceDate)} · <Money paise={flag.matched.amountPaise} /> ·{" "}
                {flag.matched.status.replace(/_/g, " ").toLowerCase()}
              </p>
            ) : flag.matchedElsewhere ? (
              <p className="mt-1.5 text-xs text-muted-foreground">Matches an invoice raised to another builder on the platform. Details are withheld.</p>
            ) : flag.externalRef ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Registry reference <span className="font-mono">{flag.externalRef}</span>
              </p>
            ) : null}
            {flag.status !== "OPEN" && (
              <p className="mt-2 text-xs text-muted-foreground">
                {flag.reviewedByName ?? "Reviewer"}
                {flag.reviewedAt ? ` · ${formatDateTime(flag.reviewedAt)}` : ""}
                {flag.reviewNote ? <span className="mt-0.5 block text-fg-soft italic">&ldquo;{flag.reviewNote}&rdquo;</span> : null}
              </p>
            )}
          </div>
        </div>
        {canResolve && flag.status === "OPEN" && (
          <div className="flex shrink-0 flex-wrap gap-2 pl-11 sm:pl-0">
            <ActionDialog
              trigger="Not a duplicate"
              triggerVariant="outline"
              triggerSize="sm"
              triggerIcon={<CheckCircle2 className="size-3.5 text-leaf" />}
              title="Clear this flag"
              description="Record why this invoice is not a duplicate. The note is kept in the audit trail."
              confirmLabel="Clear flag"
              confirmVariant="success"
              field={{ name: "note", label: "Your conclusion", placeholder: "e.g. Separate bookings for units B-1104 and B-1202 with the same brokerage.", required: true, minLength: 10 }}
              action={resolveDuplicateFlagAction.bind(null, flag.id, "CLEARED")}
            />
            <ActionDialog
              trigger="Confirm duplicate"
              triggerVariant="ghost"
              triggerSize="sm"
              triggerIcon={<ShieldAlert className="size-3.5 text-danger" />}
              title="Confirm duplicate"
              description="Record that this invoice duplicates another. Reject the invoice separately if it is still awaiting your decision."
              confirmLabel="Confirm duplicate"
              confirmVariant="destructive"
              field={{ name: "note", label: "Your conclusion", placeholder: "e.g. Same booking already invoiced under GFH/2026/001.", required: true, minLength: 10 }}
              action={resolveDuplicateFlagAction.bind(null, flag.id, "CONFIRMED")}
            />
          </div>
        )}
      </div>
    </li>
  );
}

/** "Possible duplicates" list for the builder review page and the platform's integrity view. */
export function DuplicateFlagList({
  flags,
  canResolve,
  showInvoice = false,
  linkBase = null,
  className,
}: {
  flags: DuplicateFlagDto[];
  canResolve: boolean;
  showInvoice?: boolean;
  linkBase?: string | null;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-hairline", className)}>
      {flags.map((flag) => (
        <FlagRow key={flag.id} flag={flag} canResolve={canResolve} showInvoice={showInvoice} linkBase={linkBase} />
      ))}
    </ul>
  );
}
