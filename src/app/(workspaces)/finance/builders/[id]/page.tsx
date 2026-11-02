import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, Building2, ListChecks, Wallet } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { DetailList, EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { formatBps, formatINR, formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getFinanceBuilderDetail } from "@/server/queries/finance";
import { RequestTable } from "../../_components/request-table";
import { orNotFound } from "../../_lib/records";

export const metadata: Metadata = { title: "Builder · Veefin Finance" };

export default async function BuilderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWorkspace("finance");
  const { id } = await params;
  const { organisation: org, programme, programmes, requests, watchlist, metrics } = await orNotFound(getFinanceBuilderDetail(actor, id));

  return (
    <>
      <PageHeader
        back={{ href: "/finance/builders", label: "Builders" }}
        eyebrow="Builder"
        title={org.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="record" status={org.status} />
            <span>{org.legalName}</span>
          </span>
        }
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Agreed discount" value={formatBps(programme.discountRateBps)} hint={`${programme.code} · ${programme.status.toLowerCase()}`} icon={BadgeCheck} tone="gold" />
        <StatCard label="Approved invoices" value={formatINRCompact(metrics.approvedInvoiceValue)} hint={`${metrics.approvedInvoiceCount} builder-approved`} icon={Building2} tone="slate" />
        <StatCard label="Financed" value={formatINRCompact(metrics.financedValue)} hint={`${metrics.financedCount} of ${metrics.requestCount} requests`} icon={Wallet} tone="heritage" />
        <StatCard
          label="Outstanding settlement"
          value={formatINRCompact(metrics.outstandingValue)}
          hint={metrics.overdueCount ? `${formatINR(metrics.overdueValue)} overdue` : "None overdue"}
          icon={metrics.overdueCount ? AlertTriangle : ListChecks}
          tone={metrics.overdueCount ? "gold" : "navy"}
        />
      </StatGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Section title="Organisation profile">
          <DetailList
            items={[
              { label: "Legal name", value: org.legalName },
              { label: "GSTIN", value: <span className="tabular">{org.gstin ?? "—"}</span> },
              { label: "PAN", value: <span className="tabular">{org.pan ?? "—"}</span> },
              { label: "RERA registration", value: org.reraNumber ?? "—" },
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
              { label: "Empanelled channel partners", value: org.builderRelationships.length },
              { label: "Projects", value: org.projects.length },
            ]}
          />
        </Section>

        <Section title="Programme" description="Agreed with Veefin off-platform; configured by the Super Admin">
          <p className="eyebrow tabular text-gold-600">{programme.code}</p>
          <p className="mt-1 font-display text-lg leading-snug font-semibold text-navy">{programme.name}</p>
          <div className="mt-4">
            <DetailList
              items={[
                { label: "Discount", value: <span className="tabular font-semibold text-heritage">{formatBps(programme.discountRateBps)}</span> },
                { label: "Status", value: <StatusBadge kind="programme" status={programme.status} /> },
                { label: "Effective", value: `${formatDate(programme.effectiveFrom)} – ${programme.effectiveTo ? formatDate(programme.effectiveTo) : "open"}` },
                { label: "Offer validity", value: `${programme.offerValidityDays} days` },
              ]}
            />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-ink">{programme.terms}</p>
          {programmes.length > 1 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {programmes.length - 1} earlier programme{programmes.length === 2 ? "" : "s"}: {programmes.filter((p) => p.id !== programme.id).map((p) => `${p.code} (${formatBps(p.discountRateBps)}, ${p.status.toLowerCase()})`).join("; ")}
            </p>
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Section title="Projects" description={`${org.projects.length} registered project${org.projects.length === 1 ? "" : "s"}`}>
          {org.projects.length === 0 ? (
            <EmptyState icon={Building2} title="No projects" className="py-8" />
          ) : (
            <DataTable minWidth={520}>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>City</Th>
                  <Th>RERA</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {org.projects.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <span className="font-medium text-navy">{p.name}</span>
                      <p className="tabular text-xs text-muted-foreground">{p.code}</p>
                    </Td>
                    <Td>{p.city}</Td>
                    <Td className="tabular text-xs">{p.reraNumber ?? "—"}</Td>
                    <Td>
                      <StatusBadge kind="record" status={p.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>

        <Section title="Open settlements" description="Builder repayments due to Veefin">
          {watchlist.length === 0 ? (
            <EmptyState icon={ListChecks} title="Nothing outstanding" description="All disbursed requests for this builder are settled." className="py-8" />
          ) : (
            <DataTable minWidth={520}>
              <thead>
                <tr>
                  <Th>Request</Th>
                  <Th>Due</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((w) => (
                  <Tr key={w.request.id}>
                    <Td>
                      <Link href={`/finance/requests/${w.request.id}`} className="tabular font-medium whitespace-nowrap text-navy hover:underline">
                        {w.request.reference}
                      </Link>
                      <p className="text-xs text-muted-foreground">{w.request.cp.name}</p>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(w.dueDate)}</Td>
                    <Td align="right">{formatINR(w.amountPaise)}</Td>
                    <Td>
                      <StatusBadge kind="settlement" status={w.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>

      <Section className="mt-6" title="Financing requests" description={`${requests.length} request${requests.length === 1 ? "" : "s"} on invoices approved by ${org.name}`}>
        {requests.length === 0 ? (
          <EmptyState icon={ListChecks} title="No financing requests yet" className="py-10" />
        ) : (
          <RequestTable rows={requests} hide={["builder"]} />
        )}
      </Section>
    </>
  );
}
