import type { Metadata } from "next";
import { Building2, Info, Landmark, ShieldCheck, Users } from "lucide-react";
import { formatDate, formatDateTime, initials } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { getPartnerProfile } from "@/server/queries/partner";
import { RefCell, Table, Td, Th, Tr } from "../_components/table";
import { EmptyNote, FacadePattern, Facts, PageIntro, Panel, StatusMark, StatusPill } from "../_components/ui";

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
      <PageIntro
        eyebrow="Organisation profile"
        title={org.name}
        description={`${org.legalName} · Channel partner on BrickFlow since ${formatDate(org.createdAt)}`}
        actions={<StatusPill kind="record" status={org.status} label="Account" />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel eyebrow="KYC verified" title="Registration details">
            <Facts
              items={[
                { label: "Legal name", value: org.legalName },
                { label: "Organisation type", value: "Channel partner" },
                { label: "GSTIN", value: org.gstin },
                { label: "PAN", value: org.pan },
                { label: "RERA registration", value: org.reraNumber },
                { label: "Primary contact", value: org.contactName },
                { label: "Contact email", value: org.contactEmail },
                { label: "Contact phone", value: org.contactPhone },
                { label: "Registered address", value: address || null, wide: true },
              ]}
            />
          </Panel>

          <Panel eyebrow="Relationships" title="Empanelled builders" description="Builders you can raise invoices to" bodyClassName="pb-0">
            {empanelments.length === 0 ? (
              <div className="-mx-5 border-t border-hairline sm:-mx-7">
                <EmptyNote compact icon={Building2} title="No empanelments" description="Ask the platform administrator to add your builder empanelments." />
              </div>
            ) : (
              <Table minWidth={560}>
                <thead>
                  <tr>
                    <Th>Builder</Th>
                    <Th>Empanelment code</Th>
                    <Th align="right">Credit period</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {empanelments.map((rel) => (
                    <Tr key={rel.id}>
                      <Td>
                        <RefCell primary={rel.builder.name} secondary={`Empanelled ${formatDate(rel.empanelledAt)}`} />
                      </Td>
                      <Td className="text-[0.8125rem] tracking-wide">{rel.empanelmentCode}</Td>
                      <Td align="right" className="text-[0.8125rem]">
                        {rel.creditPeriodDays} days
                      </Td>
                      <Td>
                        <StatusMark kind="record" status={rel.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel
            eyebrow="Access"
            title="Team members"
            description={`${org.members.length} ${org.members.length === 1 ? "user" : "users"} with access to this workspace`}
            bodyClassName="pb-0"
          >
            {org.members.length === 0 ? (
              <div className="-mx-5 border-t border-hairline sm:-mx-7">
                <EmptyNote compact icon={Users} title="No team members" />
              </div>
            ) : (
              <Table minWidth={640}>
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
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-basalt font-display text-sm font-semibold text-kota">{initials(member.user.name)}</span>
                          <div className="min-w-0">
                            <p className="font-medium text-basalt">
                              {member.user.name}
                              {member.user.id === actor.userId && (
                                <span className="ml-2 rounded-full bg-kota-100 px-1.5 py-px text-[0.625rem] font-semibold tracking-wide text-kota-700 uppercase">You</span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs whitespace-nowrap text-muted-foreground">{member.user.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <p className="text-[0.8125rem] text-basalt">{member.role.name}</p>
                        {member.designation && <p className="mt-0.5 text-xs text-muted-foreground">{member.designation}</p>}
                      </Td>
                      <Td className="text-[0.8125rem] whitespace-nowrap">{member.user.lastLoginAt ? formatDateTime(member.user.lastLoginAt) : "Never"}</Td>
                      <Td>
                        <StatusMark kind="record" status={member.user.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="animate-fade-up">
            <p className="mb-3 text-[0.625rem] font-semibold tracking-[0.2em] text-kota-700 uppercase">Payout account</p>
            <div className="surface-basalt relative isolate aspect-[1.586] overflow-hidden p-6">
              <FacadePattern className="inset-y-0 right-0 -z-10 h-full w-full text-kota/[0.14]" />
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between">
                  <Landmark className="size-5 text-kota" strokeWidth={1.5} />
                  <span className="text-[0.5625rem] font-semibold tracking-[0.22em] text-kota uppercase">Registered</span>
                </div>
                <p className="mt-auto text-[1.125rem] tracking-[0.18em] tabular">{maskAccount(org.bankAccountNumber)}</p>
                <div className="mt-4 flex items-end justify-between gap-4 text-[0.6875rem]">
                  <div className="min-w-0">
                    <p className="text-white/45 uppercase">Account name</p>
                    <p className="mt-0.5 truncate text-white/90">{org.legalName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-white/45 uppercase">IFSC</p>
                    <p className="mt-0.5 tracking-wide text-white/90">{org.bankIfsc ?? "—"}</p>
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{org.bankName ?? "Bank not on file"} · early payments are disbursed to this account</p>
          </section>

          <div className="rounded-xl border border-border bg-card p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-basalt">
              <ShieldCheck className="size-4 text-leaf" />
              Data protection
            </p>
            Account numbers are masked throughout BrickFlow. Full bank details are only used to route simulated payouts and are never shown to builders.
          </div>

          <div role="note" className="rounded-xl border border-dashed border-kota/45 p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-basalt">
              <Info className="size-4 text-kota-700" />
              Maintained by the administrator
            </p>
            These details are maintained by the BrickFlow platform administrator after KYC verification. To change legal details, bank account, empanelments or team
            members, contact the platform administrator.
          </div>
        </aside>
      </div>
    </>
  );
}
