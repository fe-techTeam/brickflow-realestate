import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgePercent, Building2, FileStack, HandCoins, Handshake, Users } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { DetailList, EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { getOrganisationProfile } from "@/server/queries/admin";
import { maskAccount, ORG_TYPE_META, plural, ROLE_LABELS } from "../../_components/labels";
import { OrgTypeBadge } from "../../_components/org-type-badge";
import { RecordStatusToggle } from "../../_components/record-status-toggle";

export const metadata: Metadata = { title: "Organisation" };

async function load(id: string) {
  const actor = await requireWorkspace("admin");
  try {
    return { actor, profile: await getOrganisationProfile(actor, id) };
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export default async function OrganisationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, profile } = await load(id);
  const { org, programmes, stats } = profile;

  const isBuilder = org.type === "BUILDER";
  const isPartner = org.type === "CHANNEL_PARTNER";
  const empanelments = isBuilder
    ? org.builderRelationships.map((r) => ({ id: r.id, counterparty: r.cp, code: r.empanelmentCode, credit: r.creditPeriodDays, status: r.status, since: r.empanelledAt }))
    : isPartner
      ? org.cpRelationships.map((r) => ({ id: r.id, counterparty: r.builder, code: r.empanelmentCode, credit: r.creditPeriodDays, status: r.status, since: r.empanelledAt }))
      : [];
  const address = [org.addressLine, org.city, org.state, org.pincode].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        back={{ href: "/admin/organisations", label: "All organisations" }}
        eyebrow={ORG_TYPE_META[org.type].label}
        title={org.name}
        description={org.legalName}
        actions={
          <>
            <StatusBadge kind="record" status={org.status} />
            {org.type !== "PLATFORM" && <RecordStatusToggle kind="organisation" id={org.id} name={org.name} status={org.status} orgType={org.type} size="default" />}
          </>
        }
      />

      <StatGrid className="2xl:grid-cols-4 xl:grid-cols-4">
        <StatCard label="Members" value={org.members.length} icon={Users} hint={`${org.members.filter((m) => m.user.status === "ACTIVE").length} active`} />
        {isBuilder || isPartner ? (
          <StatCard
            label={isBuilder ? "Projects · partners" : "Empanelled builders"}
            value={isBuilder ? `${org.projects.length} · ${empanelments.length}` : empanelments.length}
            icon={isBuilder ? Building2 : Handshake}
            hint={isBuilder ? "Projects and empanelled channel partners" : `${empanelments.filter((e) => e.status === "ACTIVE").length} active empanelments`}
          />
        ) : (
          <StatCard label="Programmes" value={programmes.length} icon={BadgePercent} hint={`${programmes.filter((p) => p.status === "ACTIVE").length} active`} />
        )}
        {stats.invoiceCount !== null ? (
          <StatCard label="Invoices" value={formatINRCompact(stats.invoicePaise ?? 0n)} icon={FileStack} hint={`${plural(stats.invoiceCount, "submitted invoice")}`} />
        ) : (
          <StatCard label="Role on platform" value={ORG_TYPE_META[org.type].label} icon={FileStack} hint="Does not raise or approve invoices" />
        )}
        <StatCard
          label="Financed value"
          value={stats.financedPaise !== null ? formatINRCompact(stats.financedPaise) : "—"}
          icon={HandCoins}
          tone="heritage"
          hint={stats.financedCount !== null ? `${plural(stats.financedCount, "request")} approved by Veefin` : "Not applicable"}
        />
      </StatGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Profile" description="Statutory and registration details.">
          <DetailList
            items={[
              { label: "Type", value: <OrgTypeBadge type={org.type} /> },
              { label: "Status", value: <StatusBadge kind="record" status={org.status} /> },
              { label: "GSTIN", value: org.gstin ? <span className="font-mono text-xs">{org.gstin}</span> : "—" },
              { label: "PAN", value: org.pan ? <span className="font-mono text-xs">{org.pan}</span> : "—" },
              { label: "RERA registration", value: org.reraNumber ?? "—" },
              { label: "Registered address", value: address || "—" },
              { label: "On platform since", value: formatDate(org.createdAt) },
              { label: "Last updated", value: formatDateTime(org.updatedAt) },
            ]}
          />
        </Section>
        <Section title="Contact & banking" description="Primary contact and the payout account on record (masked).">
          <DetailList
            items={[
              { label: "Contact person", value: org.contactName ?? "—" },
              { label: "Email", value: org.contactEmail ? <a className="text-navy hover:underline" href={`mailto:${org.contactEmail}`}>{org.contactEmail}</a> : "—" },
              { label: "Phone", value: org.contactPhone ?? "—" },
              { label: "Bank", value: org.bankName ?? "—" },
              { label: "Account number", value: maskAccount(org.bankAccountNumber) ? <span className="tabular font-mono text-xs">{maskAccount(org.bankAccountNumber)}</span> : "—" },
              { label: "IFSC", value: org.bankIfsc ? <span className="font-mono text-xs">{org.bankIfsc}</span> : "—" },
            ]}
          />
        </Section>
      </div>

      <Section className="mt-6" title="Members" description="Users who belong to this organisation and their platform role.">
        {org.members.length === 0 ? (
          <EmptyState icon={Users} title="No members" description="No user accounts are linked to this organisation." />
        ) : (
          <DataTable minWidth={820}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Designation</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <p className="font-medium text-navy">{m.user.name}</p>
                    <p className="text-xs text-muted-foreground">{m.user.email}</p>
                  </Td>
                  <Td>{ROLE_LABELS[m.role.key] ?? m.role.name}</Td>
                  <Td>{m.designation ?? "—"}</Td>
                  <Td>
                    <StatusBadge kind="record" status={m.user.status} />
                  </Td>
                  <Td className="text-xs">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "Never"}</Td>
                  <Td align="right">
                    {m.user.id === actor.userId ? (
                      <span className="text-xs text-muted-foreground">You</span>
                    ) : (
                      <RecordStatusToggle kind="user" id={m.user.id} name={m.user.name} status={m.user.status} />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      {isBuilder && (
        <Section className="mt-6" title="Projects" description="Projects channel partners can invoice against.">
          {org.projects.length === 0 ? (
            <EmptyState icon={Building2} title="No projects" description="This builder has not registered any projects yet." />
          ) : (
            <DataTable minWidth={760}>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Project</Th>
                  <Th>City</Th>
                  <Th>Location</Th>
                  <Th>RERA</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {org.projects.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-mono text-xs">{p.code}</Td>
                    <Td className="font-medium text-navy">{p.name}</Td>
                    <Td>{p.city}</Td>
                    <Td>{p.location ?? "—"}</Td>
                    <Td className="font-mono text-xs">{p.reraNumber ?? "—"}</Td>
                    <Td>
                      <StatusBadge kind="record" status={p.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      )}

      {(isBuilder || isPartner) && (
        <Section
          className="mt-6"
          title="Empanelments"
          description={isBuilder ? "Channel partners empanelled with this builder." : "Builders this channel partner is empanelled with."}
        >
          {empanelments.length === 0 ? (
            <EmptyState icon={Handshake} title="No empanelments" description="No CP–builder relationships are recorded." />
          ) : (
            <DataTable minWidth={720}>
              <thead>
                <tr>
                  <Th>{isBuilder ? "Channel partner" : "Builder"}</Th>
                  <Th>Empanelment code</Th>
                  <Th align="right">Credit period</Th>
                  <Th>Empanelled</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {empanelments.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <Link href={`/admin/organisations/${e.counterparty.id}`} className="font-medium text-navy hover:underline">
                        {e.counterparty.name}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{e.code}</Td>
                    <Td align="right">{e.credit} days</Td>
                    <Td>{formatDate(e.since)}</Td>
                    <Td>
                      <StatusBadge kind="record" status={e.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      )}

      {(isBuilder || org.type === "FINANCIER") && (
        <Section
          className="mt-6"
          title="Financing programmes"
          description="Agreed discount terms. Edit them in Financing configuration."
          actions={
            <Link href="/admin/financing" className="text-xs font-medium text-navy hover:underline">
              Open financing configuration
            </Link>
          }
        >
          {programmes.length === 0 ? (
            <EmptyState icon={BadgePercent} title="No programmes" description="No financing programme has been configured." />
          ) : (
            <DataTable minWidth={760}>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>{isBuilder ? "Financier" : "Builder"}</Th>
                  <Th align="right">Discount</Th>
                  <Th>Effective</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {programmes.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <p className="font-mono text-xs text-navy">{p.code}</p>
                      <p className="text-xs text-muted-foreground">{p.name}</p>
                    </Td>
                    <Td>{isBuilder ? p.financier.name : p.builder.name}</Td>
                    <Td align="right" className="font-display text-lg font-semibold text-heritage">
                      {formatBps(p.discountRateBps)}
                    </Td>
                    <Td className="text-xs">
                      {formatDate(p.effectiveFrom)} – {p.effectiveTo ? formatDate(p.effectiveTo) : "open-ended"}
                    </Td>
                    <Td>
                      <StatusBadge kind="programme" status={p.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      )}
    </>
  );
}
