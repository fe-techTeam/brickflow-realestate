import type { Metadata } from "next";
import { FileX2, ScanSearch, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { DuplicateFlagList } from "@/components/invoice/duplicate-flags";
import type { InvoiceDuplicateFlagStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import {
  duplicateWindowDays,
  listDuplicateFlags,
  listMatchPolicyProgrammes,
  listRejectedUploads,
  toDuplicateFlagDtos,
} from "@/server/services/invoice-integrity";
import { AdminHeader, Empty, FilterChips, Panel } from "../_components/editorial";
import { param } from "../_components/labels";
import { Ledger, LTd, LTh, LTr, RefCode } from "../_components/ledger";
import { MatchPolicyToggle } from "./_components/match-policy-toggle";

export const metadata: Metadata = { title: "Invoice integrity" };

const FLAG_FILTERS: { value: InvoiceDuplicateFlagStatus; label: string }[] = [
  { value: "OPEN", label: "Needs review" },
  { value: "CLEARED", label: "Not a duplicate" },
  { value: "CONFIRMED", label: "Confirmed" },
];

const REJECTION_REASON: Record<string, string> = {
  encrypted: "Encrypted or password-protected",
  active_content: "Scripts or automatic actions",
  embedded_file: "Embedded files",
  unreadable: "Not a readable PDF",
  too_many_pages: "Too many pages",
  no_pages: "No pages",
  malware: "Failed antivirus scan",
  scan_unavailable: "Scanner unavailable",
};

export default async function InvoiceIntegrityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const statusParam = param(sp.status);
  const status = FLAG_FILTERS.some((f) => f.value === statusParam) ? (statusParam as InvoiceDuplicateFlagStatus) : undefined;

  const [flags, openFlags, programmes, rejected] = await Promise.all([
    listDuplicateFlags(actor, { status }),
    status === "OPEN" ? null : listDuplicateFlags(actor, { status: "OPEN" }),
    listMatchPolicyProgrammes(actor),
    listRejectedUploads(actor),
  ]);
  const openCount = status === "OPEN" ? flags.length : (openFlags?.length ?? 0);
  const windowDays = duplicateWindowDays();

  return (
    <>
      <AdminHeader
        eyebrow="Platform · Integrity"
        title="Invoice integrity"
        lede="Possible duplicates across every builder and channel partner, the three-way match policy for each programme, and documents the upload checks turned away."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <ScanSearch className="size-3.5 text-fg-muted" strokeWidth={1.6} aria-hidden="true" />
              <span className="tabular font-medium text-fg">{openCount}</span> awaiting review
            </span>
            <span className="tabular">Near-duplicate window ±{windowDays} days</span>
          </>
        }
      />

      <div className="grid gap-6">
        <Panel
          eyebrow="Registry"
          title="Possible duplicates"
          description="Identical invoices are blocked at submission. These close matches are flagged for a person to decide."
          bodyClassName="px-0 pb-0"
        >
          <div className="px-5 pb-5 sm:px-7">
            <FilterChips label="Review status" param="status" pathname="/admin/integrity" searchParams={sp} allLabel="All" options={FLAG_FILTERS} />
          </div>
          {flags.length === 0 ? (
            <Empty
              icon={ShieldCheck}
              title={status === "OPEN" || !status ? "Nothing to review" : "No flags in this view"}
              description="New submissions are compared on parties, amount, date, IRN and document hash."
              className="border-t hairline"
            />
          ) : (
            <DuplicateFlagList flags={toDuplicateFlagDtos(flags)} canResolve showInvoice className="border-t hairline" />
          )}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            eyebrow="Builder approval"
            title="Three-way match policy"
            description="Builders tick invoice ↔ booking ↔ agreement before approving. A programme may make the checklist optional."
            bodyClassName="px-0 pb-2"
          >
            {programmes.length === 0 ? (
              <Empty icon={ShieldCheck} title="No programmes" description="Policies apply once a financing programme exists." />
            ) : (
              <Ledger minWidth={520}>
                <thead>
                  <tr>
                    <LTh>Programme</LTh>
                    <LTh>Status</LTh>
                    <LTh align="right">Three-way match</LTh>
                  </tr>
                </thead>
                <tbody>
                  {programmes.map((p) => (
                    <LTr key={p.id}>
                      <LTd>
                        <RefCode>{p.code}</RefCode>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{p.builder.name}</span>
                      </LTd>
                      <LTd>
                        <StatusBadge kind="programme" status={p.status} />
                      </LTd>
                      <LTd align="right">
                        <MatchPolicyToggle programmeId={p.id} programmeCode={p.code} optional={p.attestationOptional} />
                      </LTd>
                    </LTr>
                  ))}
                </tbody>
              </Ledger>
            )}
          </Panel>

          <Panel eyebrow="Upload checks" title="Rejected documents" description="Latest uploads stopped in quarantine. The files were deleted; the reason stays in the audit trail." bodyClassName="px-0 pb-2">
            {rejected.length === 0 ? (
              <Empty icon={FileX2} title="No rejected uploads" description="Every uploaded PDF has passed the structure and security checks." />
            ) : (
              <Ledger minWidth={520}>
                <thead>
                  <tr>
                    <LTh>When</LTh>
                    <LTh>Reason</LTh>
                    <LTh>Uploaded by</LTh>
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((r) => (
                    <LTr key={r.id}>
                      <LTd className="tabular text-xs whitespace-nowrap">{formatDateTime(r.at)}</LTd>
                      <LTd>
                        <span className="text-sm text-fg">{(r.reason && REJECTION_REASON[r.reason]) ?? "Rejected"}</span>
                        <span className="mt-0.5 block max-w-xs truncate text-xs text-muted-foreground" title={r.summary}>
                          {r.summary}
                        </span>
                      </LTd>
                      <LTd className="text-sm">{r.actorName}</LTd>
                    </LTr>
                  ))}
                </tbody>
              </Ledger>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
