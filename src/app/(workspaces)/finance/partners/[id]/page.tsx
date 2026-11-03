import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, ListChecks, Lock } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { getFinancePartnerDetail } from "@/server/queries/finance";
import { PayoutCard } from "../../_components/facility";
import { Count, EmptyNote, FactList, KeyFigures, Masthead, Money, Monogram, Panel } from "../../_components/ledger";
import { LedgerTable, LTd, LTh, LTr } from "../../_components/ledger-table";
import { RequestTable } from "../../_components/request-table";
import { orNotFound } from "../../_lib/records";

export const metadata: Metadata = { title: "Channel partner · Veefin Finance" };

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWorkspace("finance");
  const { id } = await params;
  const { profile, relationships, requests, metrics } = await orNotFound(getFinancePartnerDetail(actor, id));

  return (
    <>
      <Masthead
        back={{ href: "/finance/partners", label: "Channel partners" }}
        eyebrow="Channel partner · Beneficiary dossier"
        title={
          <span className="flex items-center gap-4">
            <Monogram name={profile.name} size="lg" />
            <span className="min-w-0">{profile.name}</span>
          </span>
        }
        context={[
          <StatusBadge key="s" kind="record" status={profile.status} />,
          <span key="l">{profile.legalName}</span>,
          profile.city ? (
            <span key="c" className="text-muted-foreground">
              {profile.city}
            </span>
          ) : null,
        ]}
      />

      <KeyFigures
        items={[
          { label: "Financing requests", value: <Count value={metrics.requestCount} />, hint: "Raised with Veefin" },
          { label: "Pending approval", value: <Count value={metrics.pendingCount} />, hint: metrics.pendingCount ? "Awaiting a credit decision" : "None waiting", accent: "kota" },
          {
            label: "Net disbursed",
            value: <Money paise={metrics.disbursedValue} compact size="lg" className="text-leaf" />,
            hint: `${metrics.disbursedCount} simulated payout${metrics.disbursedCount === 1 ? "" : "s"}`,
            accent: "leaf",
          },
          { label: "Discount earned", value: <Money paise={metrics.discountValue} compact size="lg" />, hint: "On disbursed requests", accent: "basalt" },
        ]}
      />

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel eyebrow="Know your beneficiary" title="Organisation profile">
          <div className="border-t border-border/70 pt-1">
            <FactList
              items={[
                { label: "Legal name", value: profile.legalName },
                { label: "GSTIN", value: <span className="tabular">{profile.gstin ?? "—"}</span> },
                { label: "PAN", value: <span className="tabular">{profile.pan ?? "—"}</span> },

                { label: "RERA registration", value: <span className="text-xs">{profile.reraNumber ?? "—"}</span> },
                { label: "Registered address", value: [profile.addressLine, profile.city, profile.state, profile.pincode].filter(Boolean).join(", ") || "—" },
                {
                  label: "Contact",
                  value: (
                    <>
                      {profile.contactName ?? "—"}
                      <span className="block text-xs text-muted-foreground">{[profile.contactEmail, profile.contactPhone].filter(Boolean).join(" · ")}</span>
                    </>
                  ),
                },
              ]}
            />
          </div>
        </Panel>

        <div className="space-y-3">
          <PayoutCard bankName={profile.bankName} accountMasked={profile.bankAccountMasked} ifsc={profile.bankIfsc} holder={profile.legalName} />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Account number masked to the last four digits.
          </p>
        </div>
      </div>

      <Panel
        className="mt-6"
        eyebrow="Relationships"
        title="Empanelment with programme builders"
        description="Builders on Veefin programmes that this partner is empanelled with"
        bodyClassName={relationships.length ? "pb-0" : undefined}
      >
        {relationships.length === 0 ? (
          <EmptyNote icon={ListChecks} title="No empanelments with programme builders" compact className="border-t border-border/70" />
        ) : (
          <LedgerTable minWidth={640}>
            <thead>
              <tr>
                <LTh>Builder</LTh>
                <LTh>Empanelment code</LTh>
                <LTh align="right">Credit period</LTh>
                <LTh>Empanelled since</LTh>
                <LTh>Status</LTh>
              </tr>
            </thead>
            <tbody>
              {relationships.map((r) => (
                <LTr key={r.id}>
                  <LTd>
                    <div className="flex items-center gap-3">
                      <Monogram name={r.builder.name} tone="leaf" size="sm" />
                      <Link href={`/finance/builders/${r.builder.id}`} className="font-medium text-basalt underline-offset-4 hover:underline">
                        {r.builder.name}
                      </Link>
                    </div>
                  </LTd>
                  <LTd className="tabular tracking-wide text-basalt">{r.empanelmentCode}</LTd>
                  <LTd align="right">{r.creditPeriodDays} days</LTd>
                  <LTd className="text-xs">{formatDate(r.empanelledAt)}</LTd>
                  <LTd>
                    <StatusBadge kind="record" status={r.status} />
                  </LTd>
                </LTr>
              ))}
            </tbody>
          </LedgerTable>
        )}
      </Panel>

      <Panel
        className="mt-6"
        eyebrow="Requests from this partner"
        title="Financing requests"
        description={`${requests.length} request${requests.length === 1 ? "" : "s"} raised with Veefin`}
        bodyClassName={requests.length ? "pb-0" : undefined}
      >
        {requests.length === 0 ? (
          <EmptyNote icon={ClipboardList} title="No financing requests yet" compact className="border-t border-border/70" />
        ) : (
          <RequestTable rows={requests} hide={["cp"]} />
        )}
      </Panel>
    </>
  );
}
