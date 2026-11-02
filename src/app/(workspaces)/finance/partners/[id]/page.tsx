import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, ClipboardList, Hourglass, ListChecks, Lock, Wallet } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { DetailList, EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getFinancePartnerDetail } from "@/server/queries/finance";
import { RequestTable } from "../../_components/request-table";
import { orNotFound } from "../../_lib/records";

export const metadata: Metadata = { title: "Channel partner · Veefin Finance" };

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWorkspace("finance");
  const { id } = await params;
  const { profile, relationships, requests, metrics } = await orNotFound(getFinancePartnerDetail(actor, id));

  return (
    <>
      <PageHeader
        back={{ href: "/finance/partners", label: "Channel partners" }}
        eyebrow="Channel partner"
        title={profile.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="record" status={profile.status} />
            <span>{profile.legalName}</span>
          </span>
        }
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Financing requests" value={metrics.requestCount} icon={ClipboardList} tone="slate" />
        <StatCard label="Pending approval" value={metrics.pendingCount} icon={Hourglass} tone="gold" />
        <StatCard label="Net disbursed" value={formatINRCompact(metrics.disbursedValue)} hint={`${metrics.disbursedCount} simulated payouts`} icon={Wallet} tone="heritage" />
        <StatCard label="Discount earned" value={formatINRCompact(metrics.discountValue)} hint="On disbursed requests" icon={BadgePercent} />
      </StatGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Section title="Organisation profile">
          <DetailList
            items={[
              { label: "Legal name", value: profile.legalName },
              { label: "GSTIN", value: <span className="tabular">{profile.gstin ?? "—"}</span> },
              { label: "PAN", value: <span className="tabular">{profile.pan ?? "—"}</span> },
              { label: "RERA registration", value: profile.reraNumber ?? "—" },
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
        </Section>

        <Section
          title="Payout bank account"
          description={
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden="true" />
              Account number masked to the last four digits
            </span>
          }
        >
          <DetailList
            columns={1}
            items={[
              { label: "Bank", value: profile.bankName ?? "—" },
              { label: "Account number", value: <span className="tabular">{profile.bankAccountMasked}</span> },
              { label: "IFSC", value: <span className="tabular">{profile.bankIfsc ?? "—"}</span> },
              { label: "Account holder", value: profile.legalName },
            ]}
          />
        </Section>
      </div>

      <Section className="mt-6" title="Empanelment with Veefin builders" description="Builders on Veefin programmes that this partner is empanelled with">
        {relationships.length === 0 ? (
          <EmptyState icon={ListChecks} title="No empanelments with programme builders" className="py-8" />
        ) : (
          <DataTable minWidth={640}>
            <thead>
              <tr>
                <Th>Builder</Th>
                <Th>Empanelment code</Th>
                <Th align="right">Credit period</Th>
                <Th>Empanelled since</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/finance/builders/${r.builder.id}`} className="font-medium text-navy hover:underline">
                      {r.builder.name}
                    </Link>
                  </Td>
                  <Td className="tabular">{r.empanelmentCode}</Td>
                  <Td align="right">{r.creditPeriodDays} days</Td>
                  <Td>{formatDate(r.empanelledAt)}</Td>
                  <Td>
                    <StatusBadge kind="record" status={r.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      <Section className="mt-6" title="Financing requests" description={`${requests.length} request${requests.length === 1 ? "" : "s"} raised with Veefin`}>
        {requests.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No financing requests yet" className="py-10" />
        ) : (
          <RequestTable rows={requests} hide={["cp"]} />
        )}
      </Section>
    </>
  );
}
