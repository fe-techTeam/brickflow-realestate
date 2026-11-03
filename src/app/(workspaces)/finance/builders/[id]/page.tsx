import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ListChecks } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getFinanceBuilderDetail } from "@/server/queries/finance";
import { FacilityCard } from "../../_components/facility";
import { Count, EmptyNote, FactList, KeyFigures, Masthead, Money, Monogram, Panel } from "../../_components/ledger";
import { LedgerTable, LTd, LTh, LTr } from "../../_components/ledger-table";
import { RequestTable } from "../../_components/request-table";
import { orNotFound } from "../../_lib/records";

export const metadata: Metadata = { title: "Builder · Veefin Finance" };

export default async function BuilderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWorkspace("finance");
  const { id } = await params;
  const { organisation: org, programme, programmes, requests, watchlist, metrics } = await orNotFound(getFinanceBuilderDetail(actor, id));
  const earlier = programmes.filter((p) => p.id !== programme.id);

  return (
    <>
      <Masthead
        back={{ href: "/finance/builders", label: "Builders" }}
        eyebrow="Builder · Obligor dossier"
        title={
          <span className="flex items-center gap-4">
            <Monogram name={org.name} tone="leaf" size="lg" />
            <span className="min-w-0">{org.name}</span>
          </span>
        }
        context={[
          <StatusBadge key="s" kind="record" status={org.status} />,
          <span key="l">{org.legalName}</span>,
          <span key="c" className="text-muted-foreground">
            {[org.city, org.state].filter(Boolean).join(", ")}
          </span>,
        ]}
      />

      <KeyFigures
        items={[
          {
            label: "Agreed discount",
            value: <Count value={formatBps(programme.discountRateBps)} className="text-kota-600" />,
            hint: `${programme.code} · ${programme.status.toLowerCase()}`,
            accent: "kota",
          },
          {
            label: "Approved invoices",
            value: <Money paise={metrics.approvedInvoiceValue} compact size="lg" />,
            hint: `${metrics.approvedInvoiceCount} builder-approved`,
            accent: "basalt",
          },
          {
            label: "Financed",
            value: <Money paise={metrics.financedValue} compact size="lg" className="text-leaf" />,
            hint: `${metrics.financedCount} of ${metrics.requestCount} requests`,
            accent: "leaf",
          },
          {
            label: "Outstanding settlement",
            value: <Money paise={metrics.outstandingValue} compact size="lg" className={metrics.overdueCount ? "text-danger" : undefined} />,
            hint: metrics.overdueCount ? (
              <>
                <Money paise={metrics.overdueValue} size="xs" /> overdue
              </>
            ) : (
              "None overdue"
            ),
            accent: metrics.overdueCount ? "danger" : "basalt",
          },
        ]}
      />

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel eyebrow="Know your obligor" title="Organisation profile">
          <div className="border-t border-border/70 pt-1">
            <FactList
              items={[
                { label: "Legal name", value: org.legalName },
                { label: "GSTIN", value: <span className="tabular">{org.gstin ?? "—"}</span> },
                { label: "PAN", value: <span className="tabular">{org.pan ?? "—"}</span> },
                { label: "RERA registration", value: <span className="text-xs">{org.reraNumber ?? "—"}</span> },

                { label: "Registered address", value: [org.addressLine, org.city, org.state, org.pincode].filter(Boolean).join(", ") || "—" },
                {
                  label: "Accounts contact",
                  value: (
                    <>
                      {org.contactName ?? "—"}
                      <span className="block text-xs text-muted-foreground">{[org.contactEmail, org.contactPhone].filter(Boolean).join(" · ")}</span>
                    </>
                  ),
                },
                { label: "Empanelled channel partners", value: <span className="tabular">{org.builderRelationships.length}</span> },
                { label: "Projects", value: <span className="tabular">{org.projects.length}</span> },
              ]}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <FacilityCard
            code={programme.code}
            name={programme.name}
            rateBps={programme.discountRateBps}
            status={programme.status}
            effectiveFrom={programme.effectiveFrom}
            effectiveTo={programme.effectiveTo}
            offerValidityDays={programme.offerValidityDays}
            footer={programme.terms}
          />
          {earlier.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {earlier.length} earlier programme{earlier.length === 1 ? "" : "s"}:{" "}
              {earlier.map((p) => `${p.code} (${formatBps(p.discountRateBps)}, ${p.status.toLowerCase()})`).join("; ")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel eyebrow="Developments" title="Projects" description={`${org.projects.length} registered project${org.projects.length === 1 ? "" : "s"}`} bodyClassName={org.projects.length ? "pb-0" : undefined}>
          {org.projects.length === 0 ? (
            <EmptyNote icon={Building2} title="No projects" compact className="border-t border-border/70" />
          ) : (
            <LedgerTable minWidth={520}>
              <thead>
                <tr>
                  <LTh>Project</LTh>
                  <LTh>City</LTh>
                  <LTh>RERA</LTh>
                  <LTh>Status</LTh>
                </tr>
              </thead>
              <tbody>
                {org.projects.map((p) => (
                  <LTr key={p.id}>
                    <LTd>
                      <span className="font-medium text-basalt">{p.name}</span>
                      <p className="tabular text-[0.6875rem] text-muted-foreground">{p.code}</p>
                    </LTd>
                    <LTd>{p.city}</LTd>
                    <LTd className="tabular text-xs">{p.reraNumber ?? "—"}</LTd>
                    <LTd>
                      <StatusBadge kind="record" status={p.status} />
                    </LTd>
                  </LTr>
                ))}
              </tbody>
            </LedgerTable>
          )}
        </Panel>

        <Panel eyebrow="Repayments due to Veefin" title="Open settlements" bodyClassName={watchlist.length ? "pb-0" : undefined}>
          {watchlist.length === 0 ? (
            <EmptyNote icon={ListChecks} title="Nothing outstanding" description="All disbursed requests for this builder are settled." compact className="border-t border-border/70" />
          ) : (
            <LedgerTable minWidth={520}>
              <thead>
                <tr>
                  <LTh>Request</LTh>
                  <LTh>Due</LTh>
                  <LTh align="right">Amount</LTh>
                  <LTh>Status</LTh>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((w) => (
                  <LTr key={w.request.id}>
                    <LTd>
                      <Link href={`/finance/requests/${w.request.id}`} className="tabular font-medium whitespace-nowrap text-basalt underline-offset-4 hover:underline">
                        {w.request.reference}
                      </Link>
                      <p className="text-xs text-muted-foreground">{w.request.cp.name}</p>
                    </LTd>
                    <LTd className="text-xs whitespace-nowrap">{formatDate(w.dueDate)}</LTd>
                    <LTd align="right">
                      <Money paise={w.amountPaise} className="text-basalt" />
                    </LTd>
                    <LTd>
                      <StatusBadge kind="settlement" status={w.status} />
                    </LTd>
                  </LTr>
                ))}
              </tbody>
            </LedgerTable>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-6"
        eyebrow="Requests on this builder"
        title="Financing requests"
        description={`${requests.length} request${requests.length === 1 ? "" : "s"} on invoices approved by ${org.name}`}
        bodyClassName={requests.length ? "pb-0" : undefined}
      >
        {requests.length === 0 ? (
          <EmptyNote icon={ListChecks} title="No financing requests yet" compact className="border-t border-border/70" />
        ) : (
          <RequestTable rows={requests} hide={["builder"]} />
        )}
      </Panel>
    </>
  );
}
