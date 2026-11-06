import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BadgePercent, Building2, Handshake, Users } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { getOrganisationProfile } from "@/server/queries/admin";
import { AdminHeader, Empty, FactList, Monogram, Panel, SummaryStrip, type StripItem } from "../../_components/editorial";
import { Count, Money, Rate } from "../../_components/figures";
import { maskAccount, ORG_TYPE_META, plural, ROLE_LABELS } from "../../_components/labels";
import { Ledger, LTd, LTh, LTr, RefCode } from "../../_components/ledger";
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

const mono = (value: string | null | undefined) => (value ? <span className="font-mono text-[0.8125rem] tracking-tight text-fg">{value}</span> : "—");

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
  const activeMembers = org.members.filter((m) => m.user.status === "ACTIVE").length;
  const activeProgramme = programmes.find((p) => p.status === "ACTIVE");

  const strip: StripItem[] = [{ label: "Members", value: <Count value={org.members.length} size="lg" />, hint: `${activeMembers} active` }];
  if (isBuilder) {
    strip.push({
      label: "Agreed discount",
      value: activeProgramme ? <Rate bps={activeProgramme.discountRateBps} size="lg" /> : <span className="text-sm text-muted-foreground">Not configured</span>,
      hint: activeProgramme ? `${activeProgramme.code} · ${activeProgramme.financier.name}` : "No active programme",
      href: "/admin/financing",
      accent: "kota",
    });
    strip.push({ label: "Projects · partners", value: <Count value={`${org.projects.length} · ${empanelments.length}`} size="lg" />, hint: "Registered projects and empanelled CPs" });
  } else if (isPartner) {
    strip.push({
      label: "Empanelled builders",
      value: <Count value={empanelments.length} size="lg" />,
      hint: `${empanelments.filter((e) => e.status === "ACTIVE").length} active empanelments`,
    });
  } else {
    strip.push({ label: "Programmes", value: <Count value={programmes.length} size="lg" />, hint: `${programmes.filter((p) => p.status === "ACTIVE").length} active` });
  }
  if (stats.invoiceCount !== null) {
    strip.push({ label: "Invoices", value: <Money paise={stats.invoicePaise ?? 0n} compact size="lg" />, hint: plural(stats.invoiceCount, "submitted invoice") });
  }
  strip.push({
    label: "Financed",
    value: stats.financedPaise !== null ? <Money paise={stats.financedPaise} compact size="lg" className="text-leaf" /> : <span className="text-sm text-muted-foreground">Not applicable</span>,
    hint: stats.financedCount !== null ? `${plural(stats.financedCount, "request")} approved by Veefin` : "Does not raise or approve invoices",
    accent: "leaf",
  });

  return (
    <>
      <AdminHeader
        back={{ href: "/admin/organisations", label: "All organisations" }}
        leading={<Monogram name={org.name} size="lg" tone={org.status === "ACTIVE" ? "basalt" : "muted"} className="hidden sm:inline-flex" />}
        eyebrow={ORG_TYPE_META[org.type].label}
        title={org.name}
        lede={org.legalName}
        meta={
          <>
            <StatusBadge kind="record" status={org.status} />
            {org.city && <span>{org.city}</span>}
            {org.gstin && <span className="font-mono tracking-tight">GSTIN {org.gstin}</span>}
            <span>On BrickFlow since {formatDate(org.createdAt)}</span>
          </>
        }
        actions={
          org.type !== "PLATFORM" ? (
            <RecordStatusToggle kind="organisation" id={org.id} name={org.name} status={org.status} orgType={org.type} size="default" />
          ) : undefined
        }
      />

      <SummaryStrip items={strip} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Dossier" title="Profile" description="Statutory and registration details.">
          <FactList
            facts={[
              { label: "Type", value: <OrgTypeBadge type={org.type} /> },
              { label: "GSTIN", value: mono(org.gstin) },
              { label: "PAN", value: mono(org.panMasked) },
              { label: "RERA registration", value: org.reraNumber ?? "—" },
              { label: "Registered address", value: address || "—" },
              { label: "Last updated", value: <span className="tabular">{formatDateTime(org.updatedAt)}</span> },
            ]}
          />
        </Panel>
        <Panel eyebrow="Dossier" title="Contact & banking" description="Primary contact and the payout account on record (masked).">
          <FactList
            facts={[
              { label: "Contact person", value: org.contactName ?? "—" },
              {
                label: "Email",
                value: org.contactEmail ? (
                  <a className="text-fg hover:underline" href={`mailto:${org.contactEmail}`}>
                    {org.contactEmail}
                  </a>
                ) : (
                  "—"
                ),
              },
              { label: "Phone", value: org.contactPhone ? <span className="tabular">{org.contactPhone}</span> : "—" },
              { label: "Bank", value: org.bankName ?? "—" },
              { label: "Account number", value: mono(maskAccount(org.bankAccountNumber)) },
              { label: "IFSC", value: mono(org.bankIfsc) },
            ]}
          />
        </Panel>
      </div>

      {(isBuilder || org.type === "FINANCIER") && (
        <Panel
          className="mt-6"
          eyebrow="Pricing"
          title="Financing programmes"
          description="Agreed discount terms. They are changed only in Financing configuration."
          actions={
            <Link href="/admin/financing" className="inline-flex items-center gap-1 text-xs font-semibold text-fg hover:text-fg-muted">
              Financing configuration
              <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          {programmes.length === 0 ? (
            <Empty icon={BadgePercent} title="No programmes" description="No financing programme has been configured." className="py-10" />
          ) : (
            <Ledger minWidth={760}>
              <thead>
                <tr>
                  <LTh>Programme</LTh>
                  <LTh>{isBuilder ? "Financier" : "Builder"}</LTh>
                  <LTh align="right">Agreed discount</LTh>
                  <LTh>Effective window</LTh>
                  <LTh>Status</LTh>
                </tr>
              </thead>
              <tbody>
                {programmes.map((p) => (
                  <LTr key={p.id}>
                    <LTd>
                      <RefCode>{p.code}</RefCode>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.name}</p>
                    </LTd>
                    <LTd>{isBuilder ? p.financier.name : p.builder.name}</LTd>
                    <LTd align="right">
                      <Rate bps={p.discountRateBps} size="lg" />
                    </LTd>
                    <LTd className="tabular text-xs whitespace-nowrap">
                      {formatDate(p.effectiveFrom)} – {p.effectiveTo ? formatDate(p.effectiveTo) : "open-ended"}
                    </LTd>
                    <LTd>
                      <StatusBadge kind="programme" status={p.status} />
                    </LTd>
                  </LTr>
                ))}
              </tbody>
            </Ledger>
          )}
        </Panel>
      )}

      <Panel className="mt-6" eyebrow="People" title="Members" description="Users who belong to this organisation and their platform role.">
        {org.members.length === 0 ? (
          <Empty icon={Users} title="No members" description="No user accounts are linked to this organisation." className="py-10" />
        ) : (
          <Ledger minWidth={820}>
            <thead>
              <tr>
                <LTh>Name</LTh>
                <LTh>Role</LTh>
                <LTh>Designation</LTh>
                <LTh>Status</LTh>
                <LTh>Last sign-in</LTh>
                <LTh align="right">
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {org.members.map((m) => (
                <LTr key={m.id}>
                  <LTd>
                    <div className="flex items-center gap-3">
                      <Monogram name={m.user.name} size="sm" tone={m.user.status === "ACTIVE" ? "paper" : "muted"} className="rounded-full" />
                      <div>
                        <p className="font-medium text-fg">{m.user.name}</p>
                        <p className="text-xs text-muted-foreground">{m.user.email}</p>
                      </div>
                    </div>
                  </LTd>
                  <LTd>{ROLE_LABELS[m.role.key] ?? m.role.name}</LTd>
                  <LTd>{m.designation ?? "—"}</LTd>
                  <LTd>
                    <StatusBadge kind="record" status={m.user.status} />
                  </LTd>
                  <LTd className="tabular text-xs whitespace-nowrap">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "Never"}</LTd>
                  <LTd align="right">
                    {m.user.id === actor.userId ? (
                      <span className="text-xs text-muted-foreground">You</span>
                    ) : (
                      <RecordStatusToggle kind="user" id={m.user.id} name={m.user.name} status={m.user.status} />
                    )}
                  </LTd>
                </LTr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Panel>

      {isBuilder && (
        <Panel className="mt-6" eyebrow="Portfolio" title="Projects" description="Projects channel partners can invoice against.">
          {org.projects.length === 0 ? (
            <Empty icon={Building2} title="No projects" description="This builder has not registered any projects yet." className="py-10" />
          ) : (
            <Ledger minWidth={760}>
              <thead>
                <tr>
                  <LTh>Project</LTh>
                  <LTh>City</LTh>
                  <LTh>Location</LTh>
                  <LTh>RERA</LTh>
                  <LTh>Status</LTh>
                </tr>
              </thead>
              <tbody>
                {org.projects.map((p) => (
                  <LTr key={p.id}>
                    <LTd>
                      <p className="font-medium text-fg">{p.name}</p>
                      <RefCode className="text-[0.6875rem] text-muted-foreground">{p.code}</RefCode>
                    </LTd>
                    <LTd>{p.city}</LTd>
                    <LTd>{p.location ?? "—"}</LTd>
                    <LTd className="font-mono text-xs tracking-tight">{p.reraNumber ?? "—"}</LTd>
                    <LTd>
                      <StatusBadge kind="record" status={p.status} />
                    </LTd>
                  </LTr>
                ))}
              </tbody>
            </Ledger>
          )}
        </Panel>
      )}

      {(isBuilder || isPartner) && (
        <Panel
          className="mt-6"
          eyebrow="Relationships"
          title="Empanelments"
          description={isBuilder ? "Channel partners empanelled with this builder." : "Builders this channel partner is empanelled with."}
        >
          {empanelments.length === 0 ? (
            <Empty icon={Handshake} title="No empanelments" description="No CP–builder relationships are recorded." className="py-10" />
          ) : (
            <Ledger minWidth={720}>
              <thead>
                <tr>
                  <LTh>{isBuilder ? "Channel partner" : "Builder"}</LTh>
                  <LTh>Empanelment code</LTh>
                  <LTh align="right">Credit period</LTh>
                  <LTh>Empanelled</LTh>
                  <LTh>Status</LTh>
                </tr>
              </thead>
              <tbody>
                {empanelments.map((e) => (
                  <LTr key={e.id}>
                    <LTd>
                      <div className="flex items-center gap-3">
                        <Monogram name={e.counterparty.name} size="sm" />
                        <Link href={`/admin/organisations/${e.counterparty.id}`} className="font-medium text-fg hover:underline">
                          {e.counterparty.name}
                        </Link>
                      </div>
                    </LTd>
                    <LTd>
                      <RefCode>{e.code}</RefCode>
                    </LTd>
                    <LTd align="right">{e.credit} days</LTd>
                    <LTd className="tabular">{formatDate(e.since)}</LTd>
                    <LTd>
                      <StatusBadge kind="record" status={e.status} />
                    </LTd>
                  </LTr>
                ))}
              </tbody>
            </Ledger>
          )}
        </Panel>
      )}
    </>
  );
}
