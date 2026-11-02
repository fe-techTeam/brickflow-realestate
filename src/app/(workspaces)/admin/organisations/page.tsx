import type { Metadata } from "next";
import Link from "next/link";
import { Info, Landmark } from "lucide-react";
import type { OrganisationType, RecordStatus } from "@/generated/prisma/enums";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { requireWorkspace } from "@/server/auth/session";
import { listOrganisations } from "@/server/services/admin";
import { ORG_TYPE_META, ORG_TYPE_OPTIONS, param } from "../_components/labels";
import { OrgTypeBadge } from "../_components/org-type-badge";
import { RecordStatusToggle } from "../_components/record-status-toggle";

export const metadata: Metadata = { title: "Organisations" };

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const typeParam = param(sp.type);
  const type = typeParam && typeParam in ORG_TYPE_META ? (typeParam as OrganisationType) : undefined;
  const statusParam = param(sp.status);
  const status = statusParam === "ACTIVE" || statusParam === "INACTIVE" ? (statusParam as RecordStatus) : undefined;
  const q = param(sp.q);

  const organisations = (await listOrganisations(actor, { type, search: q })).filter((o) => !status || o.status === status);
  const inactive = organisations.filter((o) => o.status === "INACTIVE").length;

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Organisations"
        description="Every organisation on the platform: the operator, the financier, builders and channel partners."
      />

      <div className="mb-6 flex animate-fade-up gap-3 rounded-lg border border-gold/30 bg-gold-100/50 px-4 py-3 text-sm text-slate-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden="true" />
        <p>
          Deactivating an organisation signs out all of its users and blocks new sign-ins. A deactivated builder cannot receive new invoices and
          stops producing financing offers; existing invoices, financing requests and settlements are kept. The platform organisation cannot be
          deactivated.
        </p>
      </div>

      <Section
        title={`${organisations.length} organisation${organisations.length === 1 ? "" : "s"}`}
        description={inactive ? `${inactive} inactive in this view` : "All shown organisations are active"}
        bodyClassName="space-y-5"
      >
        <ListToolbar
          searchPlaceholder="Search name, legal name or GSTIN…"
          filters={[
            { param: "type", label: "Types", options: ORG_TYPE_OPTIONS },
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
          <EmptyState icon={Landmark} title="No organisations match" description="Try a different search term or clear the filters." />
        ) : (
          <DataTable minWidth={960}>
            <thead>
              <tr>
                <Th>Organisation</Th>
                <Th>Type</Th>
                <Th>GSTIN</Th>
                <Th>City</Th>
                <Th align="right">Members</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {organisations.map((org) => (
                <Tr key={org.id}>
                  <Td>
                    <Link href={`/admin/organisations/${org.id}`} className="font-medium text-navy hover:underline">
                      {org.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{org.legalName}</p>
                  </Td>
                  <Td>
                    <OrgTypeBadge type={org.type} />
                  </Td>
                  <Td className="font-mono text-xs">{org.gstin ?? "—"}</Td>
                  <Td>{org.city ?? "—"}</Td>
                  <Td align="right">{org._count.members}</Td>
                  <Td>
                    <StatusBadge kind="record" status={org.status} />
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/organisations/${org.id}`}>View</Link>
                      </Button>
                      {org.type === "PLATFORM" ? (
                        <span className="inline-flex h-8 items-center px-3 text-xs text-muted-foreground">Protected</span>
                      ) : (
                        <RecordStatusToggle kind="organisation" id={org.id} name={org.name} status={org.status} orgType={org.type} />
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
