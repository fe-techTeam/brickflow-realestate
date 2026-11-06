import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, CalendarClock, FileText, Inbox, ShieldCheck } from "lucide-react";
import type { KycStatus } from "@/generated/prisma/enums";
import { ActionDialog } from "@/components/common/action-dialog";
import { ToneBadge } from "@/components/common/status-badge";
import { CHECK_STATUS, KYC_STATUS } from "@/components/kyc/kyc-status";
import { formatDate, formatDateTime } from "@/lib/format";
import { approveVerificationAction, rejectVerificationAction } from "@/server/actions/kyc";
import { requireWorkspace } from "@/server/auth/session";
import { listKycReviewQueue, listOrganisationKycStatuses, reraExpiryReminders } from "@/server/services/kyc";
import { AdminHeader, Empty, FilterChips, Monogram, Note, Panel, SummaryStrip } from "../_components/editorial";
import { Count } from "../_components/figures";
import { param } from "../_components/labels";
import { Ledger, LTd, LTh, LTr } from "../_components/ledger";
import { OrgTypeBadge } from "../_components/org-type-badge";

export const metadata: Metadata = { title: "KYC Review" };

const STATUS_ORDER: KycStatus[] = ["REJECTED", "PENDING", "EXPIRED", "NOT_STARTED", "VERIFIED"];

export default async function KycReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const statusParam = param(sp.kyc);
  const statusFilter = statusParam && statusParam in KYC_STATUS ? (statusParam as KycStatus) : undefined;

  const [queue, organisations, reminders] = await Promise.all([listKycReviewQueue(actor), listOrganisationKycStatuses(actor), reraExpiryReminders()]);
  const count = (status: KycStatus) => organisations.filter((o) => o.kycStatus === status).length;
  const listed = organisations.filter((o) => !statusFilter || o.kycStatus === statusFilter).sort((a, b) => STATUS_ORDER.indexOf(a.kycStatus) - STATUS_ORDER.indexOf(b.kycStatus) || a.name.localeCompare(b.name));

  return (
    <>
      <AdminHeader
        eyebrow="Compliance"
        title="KYC Review"
        lede="Registrations that need a decision: name mismatches, shared bank accounts and RERA certificates. Every decision is recorded in the audit log."
      />

      <SummaryStrip
        items={[
          { label: "Awaiting decision", value: <Count value={queue.length} size="lg" />, hint: queue.length ? `Oldest from ${formatDate(queue[0]!.checkedAt)}` : "Queue is clear", accent: "kota" },
          { label: "Verified", value: <Count value={count("VERIFIED")} size="lg" />, hint: `of ${organisations.length} organisations`, accent: "leaf" },
          { label: "In progress", value: <Count value={count("PENDING") + count("NOT_STARTED")} size="lg" />, hint: `${count("NOT_STARTED")} not started` },
          { label: "Needs attention", value: <Count value={count("REJECTED") + count("EXPIRED")} size="lg" />, hint: `${count("EXPIRED")} expired`, accent: "basalt" },
        ]}
      />

      <Panel eyebrow="Queue" title={queue.length ? `${queue.length} verification${queue.length === 1 ? "" : "s"} to review` : "Nothing to review"} description="Oldest first. Approving a bank account with no payout account on file makes it the payout account." bodyClassName="p-0 sm:p-0">
        {queue.length === 0 ? (
          <Empty icon={Inbox} title="The review queue is clear" description="New submissions that need a decision appear here." className="py-12" />
        ) : (
          <ul className="divide-y divide-border/70">
            {queue.map((item) => (
              <li key={item.id} className="grid gap-4 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Monogram name={item.organisation.name} size="sm" />
                    <Link href={`/admin/organisations/${item.organisation.id}`} className="font-medium text-fg hover:underline">
                      {item.organisation.name}
                    </Link>
                    <OrgTypeBadge type={item.organisation.type} />
                  </div>
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg">
                    <span className="font-semibold">{item.label}</span>
                    <ToneBadge meta={CHECK_STATUS[item.status]} />
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono tracking-wide text-fg-soft">{item.inputMasked}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.provider}</span>
                    <span aria-hidden="true">·</span>
                    <span>Submitted {formatDateTime(item.checkedAt)}</span>
                    {item.nameMatchScore !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          Name match <span className="figure text-fg-soft">{item.nameMatchScore}%</span>
                        </span>
                      </>
                    )}
                  </p>
                  {item.reasons.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-md border-l-2 border-warning/60 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
                      {item.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                    <div className="flex min-w-0 gap-2">
                      <dt className="shrink-0 text-muted-foreground">Legal name on file</dt>
                      <dd className="min-w-0 break-words text-fg-soft">{item.organisation.legalName}</dd>
                    </div>
                    {item.bankAccount && (
                      <div className="flex min-w-0 gap-2">
                        <dt className="shrink-0 text-muted-foreground">Declared holder</dt>
                        <dd className="min-w-0 break-words text-fg-soft">{item.bankAccount.accountHolderName}</dd>
                      </div>
                    )}
                    {item.facts.map((fact) => (
                      <div key={fact.label} className="flex min-w-0 gap-2">
                        <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
                        <dd className="min-w-0 break-words text-fg-soft">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {item.documentId && (
                    <a href={`/api/documents/kyc/${item.documentId}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                      <FileText className="size-3.5" strokeWidth={1.75} />
                      Open certificate
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2 lg:flex-col lg:items-stretch">
                  <ActionDialog
                    trigger="Approve"
                    triggerVariant="success"
                    triggerSize="sm"
                    triggerIcon={<BadgeCheck className="size-3.5" />}
                    title={`Approve ${item.label.toLowerCase()}`}
                    eyebrow={item.organisation.name}
                    description="Confirm that you have checked the registration against the source document or public register."
                    confirmLabel="Approve"
                    confirmVariant="success"
                    field={{ name: "note", label: "Note for the audit log", placeholder: "e.g. Name verified against the partnership deed." }}
                    action={approveVerificationAction.bind(null, item.id)}
                  />
                  <ActionDialog
                    trigger="Reject"
                    triggerVariant="outline"
                    triggerSize="sm"
                    title={`Reject ${item.label.toLowerCase()}`}
                    eyebrow={item.organisation.name}
                    description="The organisation sees this reason on its Verification page and can resubmit."
                    confirmLabel="Reject"
                    confirmVariant="destructive"
                    field={{ name: "reason", label: "Reason", required: true, minLength: 10, placeholder: "e.g. The certificate has expired." }}
                    action={rejectVerificationAction.bind(null, item.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Panel eyebrow="Directory" title="Organisation KYC" description="Status derived from each organisation's latest checks." bodyClassName="space-y-5">
          <FilterChips
            label="KYC status"
            param="kyc"
            pathname="/admin/kyc"
            searchParams={sp}
            allCount={organisations.length}
            options={STATUS_ORDER.map((status) => ({ value: status, label: KYC_STATUS[status].label, count: count(status) }))}
          />
          {listed.length === 0 ? (
            <Empty icon={ShieldCheck} title="No organisations with this status" />
          ) : (
            <Ledger minWidth={520}>
              <thead>
                <tr>
                  <LTh>Organisation</LTh>
                  <LTh>Type</LTh>
                  <LTh>KYC</LTh>
                  <LTh>Since</LTh>
                </tr>
              </thead>
              <tbody>
                {listed.map((org) => (
                  <LTr key={org.id}>
                    <LTd>
                      <Link href={`/admin/organisations/${org.id}`} className="font-medium text-fg hover:underline">
                        {org.name}
                      </Link>
                    </LTd>
                    <LTd>
                      <OrgTypeBadge type={org.type} />
                    </LTd>
                    <LTd>
                      <ToneBadge meta={KYC_STATUS[org.kycStatus]} />
                    </LTd>
                    <LTd className="text-xs whitespace-nowrap">{org.kycStatusAt ? formatDate(org.kycStatusAt) : "—"}</LTd>
                  </LTr>
                ))}
              </tbody>
            </Ledger>
          )}
        </Panel>

        <Panel eyebrow="Renewals" title="RERA registrations expiring" description="Within the next 30 days, or already lapsed.">
          {reminders.length === 0 ? (
            <Note icon={CalendarClock} tone="leaf">
              No RERA agent registration expires in the next 30 days.
            </Note>
          ) : (
            <ul className="divide-y divide-border/70">
              {reminders.map((reminder) => (
                <li key={reminder.organisationId} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/organisations/${reminder.organisationId}`} className="text-sm font-medium text-fg hover:underline">
                      {reminder.organisationName}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{reminder.registrationNumber}</p>
                  </div>
                  <p className={reminder.expired ? "text-xs font-medium whitespace-nowrap text-danger" : "text-xs whitespace-nowrap text-warning"}>
                    {reminder.expired ? `Expired ${formatDate(reminder.expiresAt)}` : `${reminder.daysRemaining} days left`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
