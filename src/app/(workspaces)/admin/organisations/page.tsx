import type { Metadata } from "next";
import Link from "next/link";
import { Info, Landmark, ShieldCheck } from "lucide-react";
import type { OrganisationType, RecordStatus } from "@/generated/prisma/enums";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { requireWorkspace } from "@/server/auth/session";
import { listOrganisations } from "@/server/services/admin";
import { AdminHeader, Empty, FilterChips, Monogram, Note, Panel, SummaryStrip } from "../_components/editorial";
import { Count } from "../_components/figures";
import { ORG_TYPE_META, param } from "../_components/labels";
import { Ledger, LTd, LTh, LTr } from "../_components/ledger";
import { OrgTypeBadge } from "../_components/org-type-badge";
import { RecordStatusToggle } from "../_components/record-status-toggle";

export const metadata: Metadata = { title: "Organisations" };

const TYPE_ORDER: OrganisationType[] = ["BUILDER", "CHANNEL_PARTNER", "FINANCIER", "PLATFORM"];
const TYPE_PLURAL: Record<OrganisationType, string> = { BUILDER: "Builders", CHANNEL_PARTNER: "Channel partners", FINANCIER: "Financiers", PLATFORM: "Platform" };

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const typeParam = param(sp.type);
  const type = typeParam && typeParam in ORG_TYPE_META ? (typeParam as OrganisationType) : undefined;
  const statusParam = param(sp.status);
  const status = statusParam === "ACTIVE" || statusParam === "INACTIVE" ? (statusParam as RecordStatus) : undefined;
  const q = param(sp.q);

  const [all, matching] = await Promise.all([listOrganisations(actor, {}), listOrganisations(actor, { search: q })]);
  const statusMatched = matching.filter((o) => !status || o.status === status);
  const organisations = statusMatched.filter((o) => !type || o.type === type);
  const inactiveTotal = all.filter((o) => o.status === "INACTIVE").length;
  const memberTotal = all.reduce((n, o) => n + o._count.members, 0);

  return (
    <>
      <AdminHeader
        eyebrow="Directory"
        title="Organisations"
        lede="Every institution on BrickFlow: the operator, the financier, the builders and the channel partners who invoice them."
      />

      <SummaryStrip
        items={[
          { label: "Organisations", value: <Count value={all.length} size="lg" />, hint: `${all.length - inactiveTotal} active` },
          {
            label: "Builders",
            value: <Count value={all.filter((o) => o.type === "BUILDER").length} size="lg" />,
            hint: "Developers raising receivables",
            href: "/admin/builders",
            accent: "navy",
          },
          {
            label: "Channel partners",
            value: <Count value={all.filter((o) => o.type === "CHANNEL_PARTNER").length} size="lg" />,
            hint: "Brokerages invoicing builders",
            href: "/admin/partners",
            accent: "heritage",
          },
          { label: "Members", value: <Count value={memberTotal} size="lg" />, hint: inactiveTotal ? `${inactiveTotal} organisation(s) inactive` : "All organisations active", accent: "gold" },
        ]}
      />

      <Panel
        eyebrow="Register"
        title={`${organisations.length} organisation${organisations.length === 1 ? "" : "s"}`}
        description={type ? `Showing ${TYPE_PLURAL[type].toLowerCase()} only.` : "All organisation types."}
        bodyClassName="space-y-5"
      >
        <FilterChips
          label="Organisation type"
          param="type"
          pathname="/admin/organisations"
          searchParams={sp}
          allCount={statusMatched.length}
          options={TYPE_ORDER.map((t) => ({ value: t, label: TYPE_PLURAL[t], count: statusMatched.filter((o) => o.type === t).length }))}
        />
        <ListToolbar
          searchPlaceholder="Search name, legal name or GSTIN…"
          filters={[
            {
              param: "status",
              label: "Statuses",
              options: [
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ],
            },
          ]}
        />
        {organisations.length === 0 ? (
          <Empty icon={Landmark} title="No organisations match" description="Try a different search term, another type or clear the filters." />
        ) : (
          <Ledger minWidth={960}>
            <thead>
              <tr>
                <LTh>Organisation</LTh>
                <LTh>Type</LTh>
                <LTh>GSTIN</LTh>
                <LTh>City</LTh>
                <LTh align="right">Members</LTh>
                <LTh>Status</LTh>
                <LTh align="right">
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {organisations.map((org) => (
                <LTr key={org.id} className={org.status === "INACTIVE" ? "bg-muted/30" : undefined}>
                  <LTd>
                    <div className="flex items-center gap-3.5">
                      <Monogram name={org.name} size="sm" tone={org.type === "PLATFORM" ? "navy" : org.status === "INACTIVE" ? "muted" : "ivory"} />
                      <div className="min-w-0">
                        <Link href={`/admin/organisations/${org.id}`} className="font-medium text-navy hover:underline">
                          {org.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{org.legalName}</p>
                      </div>
                    </div>
                  </LTd>
                  <LTd>
                    <OrgTypeBadge type={org.type} />
                  </LTd>
                  <LTd className="font-mono text-xs tracking-tight">{org.gstin ?? "—"}</LTd>
                  <LTd>{org.city ?? "—"}</LTd>
                  <LTd align="right" className="font-medium text-navy">
                    {org._count.members}
                  </LTd>
                  <LTd>
                    <StatusBadge kind="record" status={org.status} />
                  </LTd>
                  <LTd align="right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/organisations/${org.id}`}>View</Link>
                      </Button>
                      {org.type === "PLATFORM" ? (
                        <span className="inline-flex h-8 items-center gap-1.5 px-3 text-xs text-muted-foreground">
                          <ShieldCheck className="size-3.5 text-gold-600" strokeWidth={1.6} aria-hidden="true" />
                          Protected
                        </span>
                      ) : (
                        <RecordStatusToggle kind="organisation" id={org.id} name={org.name} status={org.status} orgType={org.type} />
                      )}
                    </div>
                  </LTd>
                </LTr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Panel>

      <Note icon={Info} className="mt-6">
        Deactivating an organisation signs out all of its users and blocks new sign-ins. A deactivated builder cannot receive new invoices and stops producing
        financing offers; existing invoices, financing requests and settlements are kept. The platform organisation cannot be deactivated.
      </Note>
    </>
  );
}
