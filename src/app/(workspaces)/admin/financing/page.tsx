import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, Handshake, Lock, ShieldCheck } from "lucide-react";
import type { ProgrammeStatus } from "@/generated/prisma/enums";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { bpsToDecimalString, formatBps } from "@/lib/money";
import { PROGRAMME_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getProgrammeConfigContext } from "@/server/queries/admin";
import { listProgrammes } from "@/server/services/admin";
import { param, plural } from "../_components/labels";
import { ProgrammeFormDialog } from "./_components/programme-form-dialog";
import { ProgrammeStatusAction } from "./_components/programme-status-action";
import type { ProgrammeRow } from "./_components/types";

export const metadata: Metadata = { title: "Financing configuration" };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Status transitions offered as one-click actions for each programme status. */
const QUICK_ACTIONS: Record<ProgrammeStatus, ("ACTIVE" | "SUSPENDED" | "CLOSED")[]> = {
  DRAFT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

const PRINCIPLES = [
  {
    icon: Handshake,
    title: "Agreed off-platform",
    body: "Each builder and Veefin negotiate a fixed discount outside BrickFlow. The Super Admin records it here as a financing programme.",
  },
  {
    icon: BadgePercent,
    title: "One fixed rate per builder",
    body: "Every early-payment offer for that builder's invoices uses the active programme's rate: no bidding, tiers or per-invoice pricing.",
  },
  {
    icon: Lock,
    title: "Read-only for everyone else",
    body: "Channel partners and builders see the rate on offers and reports but cannot change it. Accepted requests keep a snapshot of their terms.",
  },
];

export default async function FinancingConfigurationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const statusParam = param(sp.status);
  const status = statusParam && statusParam in PROGRAMME_STATUS ? (statusParam as ProgrammeStatus) : undefined;
  const q = param(sp.q)?.toLowerCase();

  const [programmes, context] = await Promise.all([listProgrammes(actor), getProgrammeConfigContext(actor)]);
  const activeByBuilder = Object.fromEntries(programmes.filter((p) => p.status === "ACTIVE").map((p) => [p.builder.id, p.code]));
  const visible = programmes.filter(
    (p) =>
      (!status || p.status === status) &&
      (!q || [p.code, p.name, p.builder.name, p.financier.name].some((v) => v.toLowerCase().includes(q))),
  );

  const rows = visible.map((p) => {
    const row: ProgrammeRow = {
      id: p.id,
      code: p.code,
      builderName: p.builder.name,
      financierName: p.financier.name,
      discountRateBps: p.discountRateBps,
      status: p.status,
      openOffers: context.openOffersByProgramme[p.id] ?? 0,
      requests: p._count.requests,
      values: {
        name: p.name,
        discountRate: bpsToDecimalString(p.discountRateBps),
        status: p.status,
        effectiveFrom: isoDate(p.effectiveFrom),
        effectiveTo: isoDate(p.effectiveTo),
        offerValidityDays: String(p.offerValidityDays),
        terms: p.terms,
      },
    };
    return { row, source: p };
  });

  const buildersWithoutActive = context.builders.filter((b) => !activeByBuilder[b.id]);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Financing configuration"
        description="The discount rate a channel partner pays for early payment is set per builder financing programme. This page is the only place it can be changed."
        actions={<ProgrammeFormDialog mode="create" builders={context.builders} financiers={context.financiers} activeByBuilder={activeByBuilder} />}
      />

      <section className="surface mb-6 animate-fade-up overflow-hidden" aria-labelledby="pricing-rule">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_2fr]">
          <div className="bg-navy px-6 py-6 text-white">
            <p className="eyebrow text-gold">Pricing rule</p>
            <h2 id="pricing-rule" className="mt-2 text-2xl font-semibold text-white">
              Fixed discount on the approved amount
            </h2>
            <p className="tabular mt-4 rounded-md bg-white/[0.06] px-3 py-2.5 font-mono text-xs leading-relaxed text-white/85">
              discount = approved amount × rate
              <br />
              net payable to CP = approved amount − discount
            </p>
            <p className="mt-3 text-xs text-white/60">Calculated on the server in paise and rounded half-up to the nearest paisa. No other charges apply.</p>
          </div>
          <ul className="grid gap-px bg-border sm:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="bg-card px-5 py-5">
                <span className="flex size-8 items-center justify-center rounded-md bg-sage text-heritage">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <p className="mt-3 text-sm font-semibold text-navy">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {buildersWithoutActive.length > 0 && (
        <div className="mb-6 flex animate-fade-up gap-3 rounded-lg border border-[#efd9ae] bg-[#fbf1df] px-4 py-3 text-sm text-[#6d4710]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-medium">{buildersWithoutActive.map((b) => b.name).join(", ")}</span>{" "}
            {buildersWithoutActive.length === 1 ? "has" : "have"} no active programme, so {buildersWithoutActive.length === 1 ? "its" : "their"} channel
            partners cannot request early payment.
          </p>
        </div>
      )}

      <Section
        title="Programmes"
        description={`${programmes.length} configured · ${Object.keys(activeByBuilder).length} active. A builder can have only one active programme at a time.`}
        bodyClassName="space-y-5"
      >
        <ListToolbar
          searchPlaceholder="Search code, builder or financier…"
          filters={[{ param: "status", label: "Statuses", options: Object.entries(PROGRAMME_STATUS).map(([value, meta]) => ({ value, label: meta.label })) }]}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={BadgePercent}
            title={programmes.length === 0 ? "No programmes yet" : "No programmes match"}
            description={programmes.length === 0 ? "Create the first programme to let channel partners request early payment." : "Try a different search or clear the filters."}
          />
        ) : (
          <DataTable minWidth={1040}>
            <thead>
              <tr>
                <Th>Programme</Th>
                <Th>Builder · financier</Th>
                <Th align="right">Agreed discount</Th>
                <Th>Status</Th>
                <Th>Effective</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, source: p }) => {
                return (
                  <Tr key={row.id}>
                    <Td className="max-w-52">
                      <p className="font-mono text-xs font-medium text-navy">{p.code}</p>
                      <p className="truncate text-xs text-muted-foreground" title={p.name}>
                        {p.name}
                      </p>
                    </Td>
                    <Td>
                      <Link href={`/admin/organisations/${p.builder.id}`} className="text-navy hover:underline">
                        {p.builder.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{p.financier.name}</p>
                      {p.builder.status === "INACTIVE" && <p className="text-xs text-[#8a5a12]">Builder inactive</p>}
                    </Td>
                    <Td align="right">
                      <span className="tabular font-display text-[1.625rem] leading-none font-semibold text-heritage">{formatBps(p.discountRateBps)}</span>
                    </Td>
                    <Td>
                      <StatusBadge kind="programme" status={p.status} />
                      <p className="mt-1.5 text-xs whitespace-nowrap text-muted-foreground">
                        {plural(p._count.offers, "offer")} · {plural(p._count.requests, "request")}
                      </p>
                      {row.openOffers > 0 && <p className="text-xs text-gold-600">{row.openOffers} open</p>}
                    </Td>
                    <Td className="text-xs whitespace-nowrap">
                      <p>From {formatDate(p.effectiveFrom)}</p>
                      <p className="text-muted-foreground">{p.effectiveTo ? `To ${formatDate(p.effectiveTo)}` : "Open-ended"}</p>
                      <p className="text-muted-foreground">Offers valid {p.offerValidityDays} days</p>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <ProgrammeFormDialog mode="edit" programme={row} />
                        {QUICK_ACTIONS[p.status].map((target) => (
                          <ProgrammeStatusAction key={target} programme={row} target={target} />
                        ))}
                      </div>
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
