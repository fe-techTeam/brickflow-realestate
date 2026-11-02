import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import type { OrganisationType } from "@/generated/prisma/enums";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { listUsers } from "@/server/services/admin";
import { ORG_TYPE_META, ORG_TYPE_OPTIONS, param, ROLE_LABELS } from "../_components/labels";
import { OrgTypeBadge } from "../_components/org-type-badge";
import { RecordStatusToggle } from "../_components/record-status-toggle";

export const metadata: Metadata = { title: "Users" };

const SORT_KEYS = ["name", "organisation", "lastLogin", "created"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const typeParam = param(sp.type);
  const type = typeParam && typeParam in ORG_TYPE_META ? (typeParam as OrganisationType) : undefined;
  const status = param(sp.status);
  const sort = readSort(sp, SORT_KEYS, { key: "organisation", dir: "asc" });

  const all = await listUsers(actor, { search: param(sp.q) });
  const filtered = all.filter((m) => (!type || m.organisation.type === type) && (!status || m.user.status === status));
  const rows = sortRows(filtered, sort, {
    name: (m) => m.user.name,
    organisation: (m) => `${m.organisation.name} ${m.user.name}`,
    lastLogin: (m) => m.user.lastLoginAt,
    created: (m) => m.user.createdAt,
  });
  const active = filtered.filter((m) => m.user.status === "ACTIVE").length;

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Users"
        description="Everyone with access to BrickFlow. A user can sign in only while both the user and their organisation are active."
      />

      <Section title={`${rows.length} user${rows.length === 1 ? "" : "s"}`} description={`${active} active · ${rows.length - active} inactive`} bodyClassName="space-y-5">
        <ListToolbar
          searchPlaceholder="Search name, email or organisation…"
          filters={[
            { param: "type", label: "Organisation types", options: ORG_TYPE_OPTIONS },
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
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No users match" description="Try a different search term or clear the filters." />
        ) : (
          <DataTable minWidth={1100}>
            <thead>
              <tr>
                <SortTh label="User" sortKey="name" sort={sort} searchParams={sp} pathname="/admin/users" />
                <SortTh label="Organisation" sortKey="organisation" sort={sort} searchParams={sp} pathname="/admin/users" />
                <Th>Role</Th>
                <Th>Designation</Th>
                <Th>Status</Th>
                <SortTh label="Last sign-in" sortKey="lastLogin" sort={sort} searchParams={sp} pathname="/admin/users" />
                <SortTh label="Created" sortKey="created" sort={sort} searchParams={sp} pathname="/admin/users" />
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const self = m.user.id === actor.userId;
                return (
                  <Tr key={m.id}>
                    <Td>
                      <p className="font-medium text-navy">
                        {m.user.name}
                        {self && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{m.user.email}</p>
                    </Td>
                    <Td>
                      <Link href={`/admin/organisations/${m.organisation.id}`} className="text-navy hover:underline">
                        {m.organisation.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <OrgTypeBadge type={m.organisation.type} />
                        {m.organisation.status === "INACTIVE" && <ToneBadge meta={{ label: "Organisation inactive", tone: "warning" }} />}
                      </div>
                    </Td>
                    <Td>{ROLE_LABELS[m.role.key] ?? m.role.name}</Td>
                    <Td>{m.designation ?? "—"}</Td>
                    <Td>
                      <StatusBadge kind="record" status={m.user.status} />
                    </Td>
                    <Td className="text-xs whitespace-nowrap">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "Never"}</Td>
                    <Td className="text-xs whitespace-nowrap">{formatDate(m.user.createdAt)}</Td>
                    <Td align="right">
                      {self ? (
                        <span className="text-xs text-muted-foreground">Your account</span>
                      ) : (
                        <RecordStatusToggle kind="user" id={m.user.id} name={m.user.name} status={m.user.status} />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
