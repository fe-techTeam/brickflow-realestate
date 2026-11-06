import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditIntegrityOverview } from "@/server/services/audit-integrity";
import { Panel } from "../../_components/editorial";
import { VerifyChainButton } from "./verify-chain-button";

const count = new Intl.NumberFormat("en-IN");

function Headline({ overview }: { overview: AuditIntegrityOverview }) {
  const latest = overview.latest;
  if (!latest) return <>Not verified yet</>;
  if (latest.status === "BROKEN" && latest.broken) return <>Broken link at entry {count.format(Number(latest.broken.seq))}</>;
  if (latest.status === "EMPTY") return <>No entries recorded yet</>;
  return <>Verified through entry {count.format(Number(latest.verifiedThroughSeq ?? 0))}</>;
}

/** Chain status for the audit log: the latest verification, the first broken link and the newest anchor. */
export function IntegrityPanel({ overview, canVerify }: { overview: AuditIntegrityOverview; canVerify: boolean }) {
  const latest = overview.latest;
  const tone = !latest ? "pending" : latest.status === "BROKEN" ? "broken" : "intact";
  const Icon = tone === "broken" ? ShieldAlert : tone === "intact" ? ShieldCheck : ShieldQuestion;
  const checkedThrough = latest?.headSeq ? Number(latest.headSeq) : 0;
  const since = Math.max(0, overview.entries - checkedThrough);

  return (
    <Panel
      eyebrow="Integrity"
      title="Audit integrity"
      description="Every entry is sealed with a SHA-256 hash of its content and of the entry before it, so editing, removing or reordering any entry breaks the chain."
      actions={canVerify ? <VerifyChainButton /> : undefined}
      className="mb-6"
    >
      <div className="grid gap-6 border-t border-border/70 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
              tone === "intact" && "bg-leaf-100 text-leaf-700 ring-leaf/25",
              tone === "broken" && "bg-danger-soft text-danger ring-danger/30",
              tone === "pending" && "bg-glass-100 text-fg-muted ring-line-strong/40",
            )}
          >
            <Icon className="size-5" strokeWidth={1.6} />
          </span>
          <div className="min-w-0">
            <p className={cn("font-display text-[1.25rem] leading-snug font-normal", tone === "broken" ? "text-danger" : "text-fg")} role="status">
              <Headline overview={overview} />
            </p>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
              {latest ? (
                <>
                  Checked {formatDateTime(latest.checkedAt)} by {latest.triggeredByName} · {count.format(latest.checkedRows)} {latest.checkedRows === 1 ? "entry" : "entries"}
                  {latest.anchorsChecked > 0 && <> · {count.format(latest.anchorsChecked)} daily {latest.anchorsChecked === 1 ? "anchor" : "anchors"}</>} · {count.format(latest.durationMs)} ms
                </>
              ) : (
                "Run a verification to confirm that no entry has been altered or removed."
              )}
            </p>
            {latest?.broken && (
              <div className="mt-4 rounded-lg border-l-2 border-danger/70 bg-danger-soft px-4 py-3 text-[0.8125rem] leading-relaxed text-fg-soft">
                <p className="font-semibold text-danger">{latest.broken.label}</p>
                {latest.broken.summary ? (
                  <p className="mt-0.5">
                    Entry {count.format(Number(latest.broken.seq))}: “{latest.broken.summary}”
                    {latest.broken.createdAt && <span className="text-muted-foreground"> · recorded {formatDateTime(latest.broken.createdAt)}</span>}
                  </p>
                ) : (
                  <p className="mt-0.5">Entry {count.format(Number(latest.broken.seq))} is missing from the log.</p>
                )}
                <p className="mt-1 text-muted-foreground">Entries up to {count.format(Number(latest.verifiedThroughSeq ?? 0))} are intact. Restore from backup and investigate access to the database.</p>
              </div>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm lg:grid-cols-1 lg:border-l lg:border-border/70 lg:pl-8">
          <div>
            <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Entries in the chain</dt>
            <dd className="figure mt-1 text-[1.125rem] text-fg">{count.format(overview.entries)}</dd>
          </div>
          <div>
            <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Recorded since last check</dt>
            <dd className="figure mt-1 text-[1.125rem] text-fg">{latest ? count.format(since) : "—"}</dd>
          </div>
          <div className="col-span-2 lg:col-span-1">
            <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Latest daily anchor</dt>
            <dd className="mt-1 text-fg-soft">
              {overview.latestAnchor ? (
                <>
                  <span className="tabular">{overview.latestAnchor.day}</span> · entry {count.format(Number(overview.latestAnchor.seq))}
                  <code className="mt-1 block truncate font-mono text-[0.6875rem] text-muted-foreground" title={overview.latestAnchor.hash}>
                    {overview.latestAnchor.hash}
                  </code>
                </>
              ) : (
                <span className="text-muted-foreground">None recorded yet</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}
