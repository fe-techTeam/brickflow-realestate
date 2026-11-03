import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, ChevronRight, CircleCheck, Clock3 } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatINRCompact, sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { getBeneficiaries } from "@/server/queries/finance";
import { effectiveSettlementStatus, listFinancingRequests, refreshSettlementStatuses } from "@/server/services/financing";
import { EmptyNote, Masthead, Money, Panel, Seal } from "../_components/ledger";
import { LedgerTable, LTd, LTh, LTr } from "../_components/ledger-table";
import { ConfirmTransferButton, InitiateDisbursementButton } from "../_components/request-actions";
import { RequestActionLink } from "../_components/request-table";
import { toDisbursementSummary } from "../_lib/summaries";

export const metadata: Metadata = { title: "Disbursements · Veefin Finance" };

function Party({ id, cp, builder, reference }: { id: string; cp: string; builder: string; reference: string }) {
  return (
    <>
      <Link href={`/finance/requests/${id}`} className="font-medium text-fg underline-offset-4 hover:underline">
        {cp}
      </Link>
      <p className="text-xs text-fg-soft/80">from {builder}</p>
      <p className="tabular mt-0.5 text-[0.6875rem] tracking-wide whitespace-nowrap text-muted-foreground">{reference}</p>
    </>
  );
}

function PipelineStage({
  index,
  label,
  count,
  value,
  caption,
  accent,
  last,
}: {
  index: string;
  label: string;
  count: number;
  value: bigint;
  caption: string;
  accent: string;
  last?: boolean;
}) {
  return (
    <a href={`#lane-${index}`} className="group relative block px-6 py-6 transition-colors hover:bg-glass/40 sm:px-7">
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-0.5", accent)} />
      <p className="flex items-baseline gap-2.5">
        <span className="tabular font-display text-lg font-normal text-fg-muted">{index}</span>
        <span className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{label}</span>
      </p>
      <div className="mt-4 flex items-end justify-between gap-4">
        <Money paise={value} compact size="lg" className="text-fg" />
        <span className="tabular text-sm text-muted-foreground">
          <span className="font-semibold text-fg">{count}</span> payout{count === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
      {!last && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 -right-3.5 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-fg-muted lg:flex"
        >
          <ChevronRight className="size-3.5" />
        </span>
      )}
    </a>
  );
}

function MobileCard({ children }: { children: ReactNode }) {
  return <li className="px-5 py-4">{children}</li>;
}

export default async function DisbursementsPage() {
  const actor = await requireWorkspace("finance");
  const now = new Date();
  await refreshSettlementStatuses(now);
  const requests = await listFinancingRequests(actor, { status: ["APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED"] });
  const ready = requests.filter((r) => r.status === "APPROVED").sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  const inProgress = requests.filter((r) => r.status === "DISBURSEMENT_INITIATED");
  const completed = requests
    .filter((r) => r.status === "DISBURSED" && r.disbursement)
    .sort((a, b) => (b.disbursement!.completedAt?.getTime() ?? 0) - (a.disbursement!.completedAt?.getTime() ?? 0));
  const beneficiaries = await getBeneficiaries(
    actor,
    ready.map((r) => r.cpId),
  );

  const readyValue = sumPaise(ready.map((r) => r.netPayablePaise));
  const inProgressValue = sumPaise(inProgress.map((r) => r.disbursement?.amountPaise ?? r.netPayablePaise));
  const completedValue = sumPaise(completed.map((r) => r.disbursement!.amountPaise));

  return (
    <>
      <Masthead
        eyebrow="Operations · Payments desk"
        title="Disbursements"
        context={[
          <span key="r">
            <strong className="font-semibold text-fg">{ready.length}</strong> ready to pay
          </span>,
          <span key="i">
            <strong className="font-semibold text-fg">{inProgress.length}</strong> in flight
          </span>,
          <span key="c">
            <strong className="tabular font-semibold text-fg">{formatINRCompact(completedValue)}</strong> paid to date
          </span>,
        ]}
        actions={
          <div className="flex items-center gap-4 rounded-xl border border-line-strong/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.07))] py-2 pr-5 pl-2">
            <Seal id="bf-seal-desk" className="size-16" />
            <p className="max-w-[13rem] text-xs leading-relaxed text-fg-soft">
              Two-step payouts: Veefin books the instruction, then confirms the transfer.
            </p>
          </div>
        }
      />

      <div className="grid animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-32px_rgba(8, 14, 24,0.3)] max-lg:divide-y max-lg:divide-border/70 lg:grid-cols-3 lg:divide-x lg:divide-border/70 lg:overflow-visible">
        <PipelineStage index="01" label="Ready to disburse" count={ready.length} value={readyValue} caption="Approved by Veefin, awaiting a payout instruction" accent="bg-haze" />
        <PipelineStage index="02" label="In flight" count={inProgress.length} value={inProgressValue} caption="Instruction booked, awaiting transfer confirmation" accent="bg-night" />
        <PipelineStage index="03" label="Completed" count={completed.length} value={completedValue} caption="Confirmed payouts, net to channel partners" accent="bg-leaf" last />
      </div>

      <div className="mt-8 space-y-6">
        <Panel id="lane-01" eyebrow="Lane 01 · Oldest approval first" title="Ready to disburse" bodyClassName={ready.length ? "pb-0" : undefined}>
          {ready.length === 0 ? (
            <EmptyNote icon={BadgeCheck} title="Nothing to disburse" description="Approved requests wait here until a payout instruction is booked." compact className="border-t border-border/70" />
          ) : (
            <>
              <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
                {ready.map((r) => {
                  const beneficiary = beneficiaries.get(r.cpId);
                  return (
                    <MobileCard key={r.id}>
                      <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div>
                          <Money paise={r.netPayablePaise} size="md" className="text-leaf" />
                          <p className="tabular text-[0.6875rem] text-muted-foreground">
                            {beneficiary?.accountMasked ?? "—"} · approved {formatDate(r.decidedAt)}
                          </p>
                        </div>
                        <InitiateDisbursementButton summary={toDisbursementSummary(r, beneficiary)} size="sm" />
                      </div>
                    </MobileCard>
                  );
                })}
              </ul>
              <LedgerTable minWidth={900} className="hidden md:block">
                <thead>
                  <tr>
                    <LTh>Channel partner</LTh>
                    <LTh>Invoice</LTh>
                    <LTh>Beneficiary account</LTh>
                    <LTh align="right">Net payable</LTh>
                    <LTh>Approved</LTh>
                    <LTh align="right">
                      <span className="sr-only">Action</span>
                    </LTh>
                  </tr>
                </thead>
                <tbody>
                  {ready.map((r) => {
                    const beneficiary = beneficiaries.get(r.cpId);
                    return (
                      <LTr key={r.id}>
                        <LTd>
                          <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                        </LTd>
                        <LTd className="tabular whitespace-nowrap text-fg">{r.invoice.invoiceNumber}</LTd>
                        <LTd>
                          <span className="tabular text-fg">{beneficiary?.accountMasked ?? "—"}</span>
                          <p className="text-xs text-muted-foreground">{beneficiary?.bankName ?? "—"}</p>
                        </LTd>
                        <LTd align="right">
                          <Money paise={r.netPayablePaise} className="font-semibold text-leaf" />
                        </LTd>
                        <LTd className="text-xs whitespace-nowrap">{formatDate(r.decidedAt)}</LTd>
                        <LTd align="right">
                          <InitiateDisbursementButton summary={toDisbursementSummary(r, beneficiary)} size="sm" />
                        </LTd>
                      </LTr>
                    );
                  })}
                </tbody>
              </LedgerTable>
            </>
          )}
        </Panel>

        <Panel
          id="lane-02"
          eyebrow="Lane 02 · Confirm to complete"
          title="In flight"
          bodyClassName={inProgress.length ? "pb-0" : undefined}
        >
          {inProgress.length === 0 ? (
            <EmptyNote icon={Clock3} title="No payouts in flight" description="Initiated disbursements wait here for transfer confirmation." compact className="border-t border-border/70" />
          ) : (
            <>
              <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
                {inProgress.map((r) => (
                  <MobileCard key={r.id}>
                    <p className="tabular text-[0.6875rem] font-semibold tracking-[0.12em] text-fg-muted">{r.disbursement?.reference ?? "—"}</p>
                    <div className="mt-1">
                      <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <Money paise={r.disbursement?.amountPaise ?? r.netPayablePaise} size="md" className="text-leaf" />
                      <ConfirmTransferButton
                        requestId={r.id}
                        paymentReference={r.disbursement?.reference ?? r.reference}
                        amountPaise={(r.disbursement?.amountPaise ?? r.netPayablePaise).toString()}
                        beneficiaryName={r.disbursement?.beneficiaryName}
                        size="sm"
                      />
                    </div>
                  </MobileCard>
                ))}
              </ul>
              <LedgerTable minWidth={900} className="hidden md:block">
                <thead>
                  <tr>
                    <LTh>Payment reference</LTh>
                    <LTh>Channel partner</LTh>
                    <LTh>Beneficiary</LTh>
                    <LTh align="right">Amount</LTh>
                    <LTh>Initiated</LTh>
                    <LTh align="right">
                      <span className="sr-only">Action</span>
                    </LTh>
                  </tr>
                </thead>
                <tbody>
                  {inProgress.map((r) => (
                    <LTr key={r.id}>
                      <LTd className="whitespace-nowrap">
                        <span className="tabular font-medium tracking-wide text-fg">{r.disbursement?.reference ?? "—"}</span>
                        <p className="mt-1 flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.16em] text-fg-muted uppercase">
                          <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-haze" />
                          Processing
                        </p>
                      </LTd>
                      <LTd>
                        <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                      </LTd>
                      <LTd>
                        <span className="text-fg">{r.disbursement?.beneficiaryName ?? "—"}</span>
                        <p className="tabular text-xs text-muted-foreground">
                          {r.disbursement?.beneficiaryAccount} · {r.disbursement?.beneficiaryIfsc}
                        </p>
                      </LTd>
                      <LTd align="right">
                        <Money paise={r.disbursement?.amountPaise ?? r.netPayablePaise} className="font-semibold text-leaf" />
                      </LTd>
                      <LTd className="text-xs whitespace-nowrap">{formatDateTime(r.disbursement?.initiatedAt)}</LTd>
                      <LTd align="right">
                        <ConfirmTransferButton
                          requestId={r.id}
                          paymentReference={r.disbursement?.reference ?? r.reference}
                          amountPaise={(r.disbursement?.amountPaise ?? r.netPayablePaise).toString()}
                          beneficiaryName={r.disbursement?.beneficiaryName}
                          size="sm"
                        />
                      </LTd>
                    </LTr>
                  ))}
                </tbody>
              </LedgerTable>
            </>
          )}
        </Panel>

        <Panel
          id="lane-03"
          eyebrow="Lane 03 · Most recent first"
          title="Completed"
          bodyClassName={completed.length ? "pb-0" : undefined}
        >
          {completed.length === 0 ? (
            <EmptyNote icon={CircleCheck} title="No completed payouts yet" description="Confirmed transfers are recorded here with their demo UTR." compact className="border-t border-border/70" />
          ) : (
            <>
              <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
                {completed.map((r) => (
                  <MobileCard key={r.id}>
                    <div className="flex items-start justify-between gap-3">
                      <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                      {r.settlement && <StatusBadge kind="settlement" status={effectiveSettlementStatus(r.settlement, now)} />}
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <Money paise={r.disbursement!.amountPaise} size="md" className="text-leaf" />
                      <p className="tabular text-right text-[0.6875rem] text-muted-foreground">
                        UTR {r.disbursement!.utr ?? "—"}
                        <span className="block">{formatDate(r.disbursement!.completedAt)}</span>
                      </p>
                    </div>
                  </MobileCard>
                ))}
              </ul>
              <LedgerTable minWidth={1000} className="hidden md:block">
                <thead>
                  <tr>
                    <LTh>Payment reference</LTh>
                    <LTh>Channel partner</LTh>
                    <LTh align="right">Amount</LTh>
                    <LTh>Disbursed</LTh>
                    <LTh>Settlement</LTh>
                    <LTh align="right">
                      <span className="sr-only">Action</span>
                    </LTh>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((r) => (
                    <LTr key={r.id}>
                      <LTd className="whitespace-nowrap">
                        <span className="tabular font-medium tracking-wide text-fg">{r.disbursement!.reference}</span>
                        <p className="tabular mt-0.5 text-[0.6875rem] text-muted-foreground">UTR {r.disbursement!.utr ?? "—"}</p>
                      </LTd>
                      <LTd>
                        <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                      </LTd>
                      <LTd align="right">
                        <Money paise={r.disbursement!.amountPaise} className="font-semibold text-leaf" />
                      </LTd>
                      <LTd className="text-xs whitespace-nowrap">{formatDate(r.disbursement!.completedAt)}</LTd>
                      <LTd>{r.settlement ? <StatusBadge kind="settlement" status={effectiveSettlementStatus(r.settlement, now)} /> : "—"}</LTd>
                      <LTd align="right">
                        <RequestActionLink id={r.id} status={r.status} />
                      </LTd>
                    </LTr>
                  ))}
                </tbody>
              </LedgerTable>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
