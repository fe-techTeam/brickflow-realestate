import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import type { OrganisationType } from "@/generated/prisma/enums";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { listUsers } from "@/server/services/admin";
import { AdminHeader, Empty, FilterChips, Monogram, Panel, SummaryStrip } from "../_components/editorial";
import { Count } from "../_components/figures";
import { ORG_TYPE_META, param, ROLE_LABELS } from "../_components/labels";
import { Ledger, LSortTh, LTd, LTh, LTr } from "../_components/ledger";
import { OrgTypeBadge } from "../_components/org-type-badge";
import { RecordStatusToggle } from "../_components/record-status-toggle";
import { ResetMfaButton } from "./_components/reset-mfa-button";

export const metadata: Metadata = { title: "Users" };

const SORT_KEYS = ["name", "organisation", "lastLogin", "created"] as const;
const TYPE_ORDER: OrganisationType[] = ["BUILDER", "CHANNEL_PARTNER", "FINANCIER", "PLATFORM"];
const TYPE_PLURAL: Record<OrganisationType, string> = { BUILDER: "Builders", CHANNEL_PARTNER: "Channel partners", FINANCIER: "Financier", PLATFORM: "Platform" };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function signedInWithinWeek(lastLoginAt: Date | null): boolean {
  return lastLoginAt !== null && lastLoginAt.getTime() >= Date.now() - WEEK_MS;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const typeParam = param(sp.type);
  const type = typeParam && typeParam in ORG_TYPE_META ? (typeParam as OrganisationType) : undefined;
  const status = param(sp.status);
  const sort = readSort(sp, SORT_KEYS, { key: "organisation", dir: "asc" });

  const all = await listUsers(actor, { search: param(sp.q) });
  const statusMatched = all.filter((m) => !status || m.user.status === status);
  const filtered = statusMatched.filter((m) => !type || m.organisation.type === type);
  const rows = sortRows(filtered, sort, {
    name: (m) => m.user.name,
    organisation: (m) => `${m.organisation.name} ${m.user.name}`,
    lastLogin: (m) => m.user.lastLoginAt,
    created: (m) => m.user.createdAt,
  });
  const active = all.filter((m) => m.user.status === "ACTIVE").length;
  const recent = all.filter((m) => signedInWithinWeek(m.user.lastLoginAt)).length;
  const blockedByOrg = all.filter((m) => m.user.status === "ACTIVE" && m.organisation.status === "INACTIVE").length;

  return (
    <>
      <AdminHeader
        eyebrow="Directory"
        title="Users"
        lede="Everyone with access to BrickFlow. A user can sign in only while both the user and their organisation are active."
      />

      <SummaryStrip
        items={[
          { label: "Accounts", value: <Count value={all.length} size="lg" />, hint: "Across every workspace" },
          { label: "Active", value: <Count value={active} size="lg" />, hint: `${all.length - active} deactivated`, accent: "leaf" },
          { label: "Signed in this week", value: <Count value={recent} size="lg" />, hint: "Last seven days", accent: "basalt" },
          {
            label: "Blocked by organisation",
            value: <Count value={blockedByOrg} size="lg" />,
            hint: blockedByOrg ? "Active users of inactive organisations" : "None at the moment",
            accent: "kota",
          },
        ]}
      />

      <Panel eyebrow="Register" title={`${rows.length} user${rows.length === 1 ? "" : "s"}`} bodyClassName="space-y-5">
        <FilterChips
          label="Organisation type"
          param="type"
          pathname="/admin/users"
          searchParams={sp}
          allCount={statusMatched.length}
          options={TYPE_ORDER.map((t) => ({ value: t, label: TYPE_PLURAL[t], count: statusMatched.filter((m) => m.organisation.type === t).length }))}
        />
        <ListToolbar
          searchPlaceholder="Search name, email or organisation…"
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
        {rows.length === 0 ? (
          <Empty icon={Users} title="No users match" description="Try a different search term, another organisation type or clear the filters." />
        ) : (
          <Ledger minWidth={1100}>
            <thead>
              <tr>
                <LSortTh label="User" sortKey="name" sort={sort} searchParams={sp} pathname="/admin/users" />
                <LSortTh label="Organisation" sortKey="organisation" sort={sort} searchParams={sp} pathname="/admin/users" />
                <LTh>Role</LTh>
                <LTh>Status</LTh>
                <LSortTh label="Last sign-in" sortKey="lastLogin" sort={sort} searchParams={sp} pathname="/admin/users" />
                <LSortTh label="Created" sortKey="created" sort={sort} searchParams={sp} pathname="/admin/users" />
                <LTh align="right">
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const self = m.user.id === actor.userId;
                return (
                  <LTr key={m.id} className={m.user.status === "INACTIVE" ? "bg-muted/30" : undefined}>
                    <LTd>
                      <div className="flex items-center gap-3">
                        <Monogram name={m.user.name} size="sm" tone={self ? "basalt" : m.user.status === "ACTIVE" ? "paper" : "muted"} className="rounded-full" />
                        <div className="min-w-0">
                          <p className="font-medium text-fg">
                            {m.user.name}
                            {self && <span className="ml-2 text-xs font-normal text-fg-muted">(you)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">{m.user.email}</p>
                        </div>
                      </div>
                    </LTd>
                    <LTd>
                      <Link href={`/admin/organisations/${m.organisation.id}`} className="text-fg hover:underline">
                        {m.organisation.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <OrgTypeBadge type={m.organisation.type} />
                        {m.organisation.status === "INACTIVE" && <ToneBadge meta={{ label: "Organisation inactive", tone: "warning" }} />}
                      </div>
                    </LTd>
                    <LTd>
                      <p>{ROLE_LABELS[m.role.key] ?? m.role.name}</p>
                      {m.designation && <p className="text-xs text-muted-foreground">{m.designation}</p>}
                    </LTd>
                    <LTd>
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge kind="record" status={m.user.status} />
                        {m.user.mfaEnabledAt && <ToneBadge meta={{ label: "2-step on", tone: "kota" }} />}
                      </div>
                    </LTd>
                    <LTd className="tabular text-xs whitespace-nowrap">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : <span className="text-muted-foreground">Never</span>}</LTd>
                    <LTd className="tabular text-xs whitespace-nowrap">{formatDate(m.user.createdAt)}</LTd>
                    <LTd align="right">
                      {self ? (
                        <span className="text-xs text-muted-foreground">Your account</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {m.user.mfaEnabledAt && <ResetMfaButton userId={m.user.id} name={m.user.name} />}
                          <RecordStatusToggle kind="user" id={m.user.id} name={m.user.name} status={m.user.status} />
                        </div>
                      )}
                    </LTd>
                  </LTr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
