import type { Metadata } from "next";
import { Building2, Info, Landmark, ShieldCheck, Users } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { DetailList, EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { getPartnerProfile } from "@/server/queries/partner";

export const metadata: Metadata = { title: "Organisation Profile" };

function maskAccount(account: string | null): string {
  if (!account) return "Not on file";
  return `${"•".repeat(Math.max(4, account.length - 4))}${account.slice(-4)}`;
}

export default async function OrganisationProfilePage() {
  const actor = await requireWorkspace("partner");
  const org = await getPartnerProfile(actor);
  const address = [org.addressLine, [org.city, org.state].filter(Boolean).join(", "), org.pincode].filter(Boolean).join(", ");
  const empanelments = [...org.cpRelationships].sort((a, b) => a.builder.name.localeCompare(b.builder.name));

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Organisation profile"
        description="Your registered organisation details, builder empanelments and team on BrickFlow."
        actions={<StatusBadge kind="record" status={org.status} className="text-xs" />}
      />

      <div role="note" className="mb-6 flex animate-fade-up items-start gap-3 rounded-lg border border-border bg-card px-5 py-4 text-sm text-slate-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-gold-600" />
        <p>
          These details are maintained by the BrickFlow platform administrator after KYC verification. To change your legal details, bank account, empanelments or team
          members, contact the platform administrator.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section title={org.name} description={org.legalName}>
            <DetailList
              items={[
                { label: "Legal name", value: org.legalName },
                { label: "Organisation type", value: "Channel partner" },
                { label: "GSTIN", value: org.gstin },
                { label: "PAN", value: org.pan },
                { label: "RERA registration", value: org.reraNumber },
                { label: "Registered address", value: address || null },
                { label: "Primary contact", value: org.contactName },
                { label: "Contact email", value: org.contactEmail },
                { label: "Contact phone", value: org.contactPhone },
                { label: "On BrickFlow since", value: formatDate(org.createdAt) },
              ]}
            />
          </Section>

          <Section title="Empanelled builders" description="Builders you can raise invoices to" bodyClassName="py-0">
            {empanelments.length === 0 ? (
              <EmptyState icon={Building2} title="No empanelments" description="Ask the platform administrator to add your builder empanelments." />
            ) : (
              <DataTable minWidth={640}>
                <thead>
                  <tr>
                    <Th>Builder</Th>
                    <Th>Empanelment code</Th>
                    <Th align="right">Credit period</Th>
                    <Th>Empanelled</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {empanelments.map((rel) => (
                    <Tr key={rel.id}>
                      <Td className="font-medium text-navy">{rel.builder.name}</Td>
                      <Td className="font-mono text-xs">{rel.empanelmentCode}</Td>
                      <Td align="right">{rel.creditPeriodDays} days</Td>
                      <Td className="whitespace-nowrap">{formatDate(rel.empanelledAt)}</Td>
                      <Td>
                        <StatusBadge kind="record" status={rel.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>

          <Section title="Team members" description={`${org.members.length} ${org.members.length === 1 ? "user" : "users"} with access to this workspace`} bodyClassName="py-0">
            {org.members.length === 0 ? (
              <EmptyState icon={Users} title="No team members" />
            ) : (
              <DataTable minWidth={720}>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Last sign-in</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {org.members.map((member) => (
                    <Tr key={member.id}>
                      <Td>
                        <p className="font-medium text-navy">
                          {member.user.name}
                          {member.user.id === actor.userId && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{member.user.email}</p>
                      </Td>
                      <Td>
                        <p>{member.role.name}</p>
                        {member.designation && <p className="text-xs text-muted-foreground">{member.designation}</p>}
                      </Td>
                      <Td className="whitespace-nowrap">{member.user.lastLoginAt ? formatDateTime(member.user.lastLoginAt) : "Never"}</Td>
                      <Td>
                        <StatusBadge kind="record" status={member.user.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Payout bank account" description="Early payments are disbursed here">
            <div className="rounded-lg bg-navy p-5 text-white">
              <div className="flex items-center justify-between">
                <Landmark className="size-5 text-gold" strokeWidth={1.6} />
                <span className="text-[0.625rem] font-semibold tracking-[0.18em] text-gold uppercase">Registered</span>
              </div>
              <p className="mt-6 font-mono text-lg tracking-wider">{maskAccount(org.bankAccountNumber)}</p>
              <p className="mt-1 text-xs text-white/60">{org.bankName ?? "Bank not on file"}</p>
              <div className="mt-5 flex justify-between text-xs">
                <span className="text-white/50">IFSC</span>
                <span className="font-mono">{org.bankIfsc ?? "—"}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 text-xs">
                <span className="text-white/50">Account name</span>
                <span className="text-right">{org.legalName}</span>
              </div>
            </div>
          </Section>

          <div className="rounded-lg border border-border bg-ivory/70 p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-navy">
              <ShieldCheck className="size-3.5 text-heritage" />
              Data protection
            </p>
            Account numbers are masked throughout BrickFlow. Full bank details are only used to route simulated payouts and are never shown to builders.
          </div>
        </div>
      </div>
    </>
  );
}
