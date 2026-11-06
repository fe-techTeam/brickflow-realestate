import { BadgeCheck, CircleAlert, Clock3, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { ActionDialog } from "@/components/common/action-dialog";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/panels";
import { ToneBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setPrimaryBankAccountAction } from "@/server/actions/kyc";
import type { CheckView, VerificationOverview } from "@/server/services/kyc";
import { BANK_ACCOUNT_STATUS, KYC_STATUS, REQUIREMENT_STATE } from "./kyc-status";
import { VerifyDialog, type VerifyKind } from "./verify-dialog";

const KYC_SUMMARY: Record<VerificationOverview["kycStatus"], string> = {
  NOT_STARTED: "Submit the registrations below to start verification.",
  PENDING: "Some registrations are still being verified or reviewed.",
  VERIFIED: "All required registrations are verified.",
  REJECTED: "One or more registrations could not be verified. Update them below.",
  EXPIRED: "A verification has lapsed. Renew it to keep receiving early payments.",
};

const NOTES: Partial<Record<VerifyKind, string>> = {
  GSTIN: "Confirms an active GST registration in your legal name.",
  PAN: "Confirms the organisation PAN with the Income Tax Department.",
  BANK_ACCOUNT: "Early payments are disbursed only to a verified account in your name.",
  RERA_AGENT: "Your MahaRERA agent registration, checked by our team.",
  UDYAM: "Optional. Your MSME category, for eligible programmes.",
};

function CheckDetail({ check }: { check: CheckView }) {
  const attention = check.status !== "VERIFIED" && check.reasons.length > 0;
  return (
    <div className="mt-2 space-y-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono tracking-wide text-fg-soft">{check.inputMasked}</span>
        <span aria-hidden="true">·</span>
        <span>Checked {formatDate(check.checkedAt)}</span>
        {check.expiresAt && check.status === "VERIFIED" && (
          <>
            <span aria-hidden="true">·</span>
            <span>Valid until {formatDate(check.expiresAt)}</span>
          </>
        )}
      </p>
      {attention && (
        <ul className="space-y-1 rounded-md border-l-2 border-warning/60 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
          {check.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {check.reviewNote && (
        <p className="text-xs leading-relaxed text-fg-muted">
          <span className="font-medium text-fg-soft">Reviewer note:</span> {check.reviewNote}
        </p>
      )}
      {check.facts.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {check.facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 break-words text-fg-soft">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function VerificationView({ overview }: { overview: VerificationOverview }) {
  const { organisation, kycStatus, payout } = overview;
  const isPartner = organisation.type === "CHANNEL_PARTNER";
  const showBank = organisation.type !== "BUILDER";
  const primary = overview.bankAccounts.find((account) => account.isPrimary) ?? null;
  const checklist = overview.items.filter((item) => item.type !== "BANK_ACCOUNT" || !showBank);
  const bankItem = overview.items.find((item) => item.type === "BANK_ACCOUNT");

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Verification"
        description={`KYC for ${organisation.legalName}. ${isPartner ? "Early payments need a complete verification and a verified payout account." : "Required to transact on BrickFlow."}`}
        actions={<ToneBadge meta={KYC_STATUS[kycStatus]} className="h-7 px-3 text-xs" />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Section eyebrow="Registrations" title="Verification checklist" description={KYC_SUMMARY[kycStatus]} bodyClassName="p-0 sm:p-0">
          <ol className="divide-y divide-hairline">
            {checklist.map((item, index) => {
              const state = REQUIREMENT_STATE[item.state];
              const kind = item.type as VerifyKind;
              const done = item.state === "VERIFIED" || item.state === "PENDING";
              return (
                <li key={item.type} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 px-5 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-6">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full text-[0.8125rem] ring-1 ring-inset sm:size-9",
                      item.state === "VERIFIED" ? "bg-leaf-50 text-leaf ring-leaf-200" : "bg-glass-50 text-fg-muted ring-line",
                    )}
                  >
                    {item.state === "VERIFIED" ? <BadgeCheck className="size-4" strokeWidth={1.75} /> : <span className="figure">{index + 1}</span>}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-fg">{item.label}</h3>
                      {!item.required && <span className="rounded-full bg-glass-100 px-2 py-px text-[0.625rem] font-semibold tracking-wide text-fg-muted uppercase">Optional</span>}
                      <ToneBadge meta={state} />
                    </div>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{NOTES[kind]}</p>
                    {item.latest && <CheckDetail check={item.latest} />}
                    {item.type === "RERA_AGENT" && item.latest?.documentId && (
                      <a href={`/api/documents/kyc/${item.latest.documentId}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                        View submitted certificate
                      </a>
                    )}
                  </div>
                  <div className="col-start-2 mt-3 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:self-start">
                    <VerifyDialog
                      kind={kind}
                      trigger={item.state === "MISSING" ? "Verify" : done ? "Update" : "Resubmit"}
                      triggerVariant={item.state === "MISSING" && item.required ? "default" : "outline"}
                      allowNotRegistered={isPartner && item.type === "GSTIN"}
                    />
                  </div>
                </li>
              );
            })}
            {isPartner && !organisation.gstRegistered && (
              <li className="flex flex-col gap-3 px-5 py-4 text-[0.8125rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <span>You declared that the organisation is not registered under GST.</span>
                <VerifyDialog kind="GSTIN" trigger="Add GSTIN" />
              </li>
            )}
          </ol>
        </Section>

        <aside className="flex min-w-0 flex-col gap-6">
          {payout && (
            <section className="surface-basalt animate-fade-up p-6" aria-labelledby="payout-readiness">
              <p className="eyebrow text-[0.625rem] text-fg-muted">Early payments</p>
              <h2 id="payout-readiness" className="mt-2 flex items-center gap-2 text-lg font-light text-fg">
                {payout.eligible ? <ShieldCheck className="size-5 text-leaf" strokeWidth={1.6} /> : <LockKeyhole className="size-5 text-warning" strokeWidth={1.6} />}
                {payout.eligible ? "Ready to receive payouts" : "Payouts on hold"}
              </h2>
              {payout.eligible ? (
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">You can accept early-payment offers. Funds are paid to your verified account ending {primary?.maskedNumber.slice(-4)}.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-[0.8125rem] leading-relaxed text-fg-soft">
                  {payout.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
              {!overview.enforced && !payout.eligible && <p className="mt-3 text-xs text-fg-muted">Verification is not yet required on this platform; offers remain available.</p>}
            </section>
          )}

          {showBank && (
            <Section
              eyebrow="Payouts"
              title="Bank accounts"
              description={bankItem?.required ? "Required for early payments." : "Used for settlements and payouts."}
              actions={<VerifyDialog kind="BANK_ACCOUNT" trigger={overview.bankAccounts.length ? "Add account" : "Add bank account"} triggerVariant={overview.bankAccounts.length ? "outline" : "default"} hasPrimaryAccount={Boolean(primary)} coolingOffHours={overview.coolingOffHours} defaultHolderName={organisation.legalName} />}
              bodyClassName="p-0 sm:p-0"
            >
              {overview.bankAccounts.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <Landmark className="size-6 text-fg-muted" strokeWidth={1.5} />
                  <p className="mt-3 text-sm font-medium text-fg">No bank account yet</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">Add the current account held in your organisation&apos;s legal name.</p>
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {overview.bankAccounts.map((account) => (
                    <li key={account.id} className="px-5 py-4 sm:px-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[0.9375rem] tracking-[0.14em] text-fg">{account.maskedNumber}</p>
                          <p className="mt-1 text-xs break-words text-muted-foreground">
                            {[account.bankName, account.ifsc].filter(Boolean).join(" · ")}
                          </p>
                          <p className="mt-0.5 text-xs break-words text-muted-foreground">{account.beneficiaryName ?? account.accountHolderName}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {account.isPrimary && <span className="rounded-full bg-signal-50 px-2 py-px text-[0.625rem] font-semibold tracking-wide text-signal-700 uppercase ring-1 ring-signal-200 ring-inset">Payout account</span>}
                          <ToneBadge meta={BANK_ACCOUNT_STATUS[account.status as keyof typeof BANK_ACCOUNT_STATUS]} />
                        </div>
                      </div>
                      {account.coolingOffUntil && (
                        <p className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
                          <Clock3 className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                          Recently changed. Early payments resume after {formatDateTime(account.coolingOffUntil)}.
                        </p>
                      )}
                      {account.latest && account.latest.status !== "VERIFIED" && account.latest.reasons.length > 0 && (
                        <p className="mt-2 text-xs leading-relaxed text-warning">{account.latest.reasons[0]}</p>
                      )}
                      {!account.isPrimary && account.status === "VERIFIED" && (
                        <div className="mt-3">
                          <ActionDialog
                            trigger="Use for payouts"
                            triggerVariant="outline"
                            triggerSize="sm"
                            title="Change payout account"
                            eyebrow="Security check"
                            description={`Future early payments will go to ${account.maskedNumber} (${account.ifsc}). For your security, early payments pause for ${overview.coolingOffHours} hours after the change, and your team is notified.`}
                            confirmLabel="Change payout account"
                            confirmVariant="default"
                            action={setPrimaryBankAccountAction.bind(null, account.id)}
                            stepUpPurpose="bank.change"
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <div className="rounded-xl border border-border bg-card p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
              <ShieldCheck className="size-4 text-leaf" />
              How we protect these details
            </p>
            PAN and bank account numbers are encrypted at rest and shown masked everywhere. Checks are made directly with the GST network, the Income Tax Department and your bank.
          </div>
        </aside>
      </div>
    </>
  );
}
