import type { Metadata } from "next";
import { Activity, CalendarClock, History, Inbox, Send } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { ToneBadge } from "@/components/common/status-badge";
import type { JobStatus, NotificationDeliveryStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import type { StatusMeta } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getJobsOverview, JOB_LIST_STATUSES, listDeliveries, listJobs } from "@/server/services/jobs-admin";
import { AdminHeader, Empty, FilterChips, Note, Panel, SummaryStrip } from "../_components/editorial";
import { param } from "../_components/labels";
import { JobActions } from "./_components/job-actions";

export const metadata: Metadata = { title: "Jobs" };

const JOB_STATUS: Record<JobStatus, StatusMeta> = {
  PENDING: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  RETRY: { label: "Retrying", tone: "warning" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  DEAD: { label: "Dead letter", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "kota" },
};

const DELIVERY_STATUS: Record<NotificationDeliveryStatus, StatusMeta> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  SENT: { label: "Sent", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  READ: { label: "Read", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  SKIPPED: { label: "Skipped", tone: "kota" },
};

const DELIVERY_FILTERS: NotificationDeliveryStatus[] = ["FAILED", "QUEUED", "SENT", "DELIVERED", "SKIPPED"];

function age(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}

function isJobStatus(value: string | undefined): value is JobStatus {
  return value !== undefined && (JOB_LIST_STATUSES as readonly string[]).includes(value);
}

function isDeliveryStatus(value: string | undefined): value is NotificationDeliveryStatus {
  return value !== undefined && Object.hasOwn(DELIVERY_STATUS, value);
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const statusParam = param(sp.status);
  const deliveryParam = param(sp.delivery);
  const status = isJobStatus(statusParam) ? statusParam : undefined;
  const deliveryStatus = isDeliveryStatus(deliveryParam) ? deliveryParam : undefined;

  const [stats, jobs, deliveries] = await Promise.all([
    getJobsOverview(actor),
    listJobs(actor, { status, take: 100 }),
    listDeliveries(actor, { status: deliveryStatus, take: 50 }),
  ]);
  const attention = stats.byStatus.RETRY + stats.byStatus.DEAD;

  return (
    <>
      <AdminHeader
        eyebrow="Platform · Operations"
        title="Jobs"
        lede="Background work queued by the platform: notification deliveries, reminders and maintenance. Failed jobs retry automatically with backoff; jobs that exhaust their attempts wait here for a decision."
        meta={
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3.5 text-fg-muted" strokeWidth={1.6} aria-hidden="true" />
            As of {formatDateTime(stats.generatedAt)}
          </span>
        }
      />

      <SummaryStrip
        items={[
          { label: "Ready to run", value: <span className="figure text-2xl">{stats.ready}</span>, hint: stats.ready ? `Oldest waiting ${age(stats.oldestReadyAgeSeconds)}` : "Queue is clear" },
          { label: "Running", value: <span className="figure text-2xl">{stats.byStatus.RUNNING}</span>, hint: stats.expiredLeases ? `${stats.expiredLeases} with an expired lease` : "All leases current" },
          { label: "Retrying", value: <span className="figure text-2xl">{stats.byStatus.RETRY}</span>, hint: "Will run again automatically", accent: stats.byStatus.RETRY ? "kota" : undefined },
          { label: "Dead letter", value: <span className="figure text-2xl">{stats.byStatus.DEAD}</span>, hint: `${stats.deadLast24h} in the last 24 h` },
          { label: "Succeeded · 24 h", value: <span className="figure text-2xl">{stats.succeededLast24h}</span>, accent: "leaf" },
        ]}
      />

      {stats.expiredLeases > 0 && (
        <Note tone="warning" icon={Activity} className="mb-6">
          {stats.expiredLeases} running job{stats.expiredLeases === 1 ? " has" : "s have"} an expired lease. A worker probably stopped mid-job; another worker will pick {stats.expiredLeases === 1 ? "it" : "them"} up automatically.
        </Note>
      )}

      <div className="grid gap-6">
        <Panel
          eyebrow="Queue"
          title={status ? `${JOB_STATUS[status].label} jobs` : attention ? "Jobs needing attention" : "Failed and dead jobs"}
          description={status ? `${jobs.total} job${jobs.total === 1 ? "" : "s"}, most recently updated first.` : "Retrying and dead-lettered jobs. Retry re-queues a job with fresh attempts; cancel stops it for good."}
          bodyClassName="space-y-5"
        >
          <FilterChips
            label="Job status"
            param="status"
            pathname="/admin/jobs"
            searchParams={sp}
            allLabel="Needs attention"
            allCount={attention}
            options={JOB_LIST_STATUSES.map((s) => ({ value: s, label: JOB_STATUS[s].label, count: stats.byStatus[s] }))}
          />
          {jobs.jobs.length === 0 ? (
            <Empty icon={Inbox} title="Nothing here" description={status ? "No jobs with this status." : "No job is failing. Deliveries and reminders are running normally."} />
          ) : (
            <DataTable minWidth={960} dense>
              <thead>
                <tr>
                  <Th>Job</Th>
                  <Th>Status</Th>
                  <Th align="right">Attempts</Th>
                  <Th>Next run / updated</Th>
                  <Th>Last error</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {jobs.jobs.map((job) => (
                  <Tr key={job.id}>
                    <Td>
                      <p className="font-mono text-[0.8125rem] text-fg">{job.type}</p>
                      <p className="mt-0.5 max-w-[18rem] truncate font-mono text-[0.6875rem] text-muted-foreground" title={job.payload}>
                        {job.id}
                      </p>
                    </Td>
                    <Td>
                      <ToneBadge meta={JOB_STATUS[job.status]} />
                    </Td>
                    <Td align="right" className="tabular">
                      {job.attempts} / {job.maxAttempts}
                    </Td>
                    <Td className="text-[0.8125rem] whitespace-nowrap">
                      {job.status === "RETRY" || job.status === "PENDING" ? formatDateTime(job.runAt) : formatDateTime(job.updatedAt)}
                    </Td>
                    <Td>
                      <p className="line-clamp-2 max-w-[22rem] font-mono text-[0.6875rem] leading-relaxed break-words text-fg-muted" title={job.lastError ?? undefined}>
                        {job.lastError ?? "—"}
                      </p>
                    </Td>
                    <Td align="right">
                      <JobActions id={job.id} type={job.type} status={job.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {jobs.total > jobs.jobs.length && <p className="text-xs text-muted-foreground">Showing the latest {jobs.jobs.length} of {jobs.total}.</p>}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-12">
          <Panel className="xl:col-span-7" eyebrow="Throughput" title="By job type" description="Open work per job type.">
            {stats.byType.length === 0 ? (
              <Empty icon={Inbox} title="No open jobs" description="Every queued job has finished." />
            ) : (
              <DataTable minWidth={520} dense>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th align="right">Queued</Th>
                    <Th align="right">Running</Th>
                    <Th align="right">Retrying</Th>
                    <Th align="right">Dead</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byType.map((row) => (
                    <Tr key={row.type}>
                      <Td className="font-mono text-[0.8125rem] text-fg">{row.type}</Td>
                      <Td align="right" className="tabular">{row.pending}</Td>
                      <Td align="right" className="tabular">{row.running}</Td>
                      <Td align="right" className="tabular">{row.retry}</Td>
                      <Td align="right" className="tabular">{row.dead}</Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Panel>
          <Panel className="xl:col-span-5" eyebrow="Recurring" title="Schedules" description="Times are India Standard Time. Each period runs once, whichever worker picks it up.">
            {stats.schedules.length === 0 ? (
              <Empty icon={CalendarClock} title="No schedules yet" description="Schedules are registered when the worker starts." />
            ) : (
              <ul className="divide-y divide-border/70 border-t border-border/70">
                {stats.schedules.map((s) => (
                  <li key={s.name} className="flex flex-col gap-1 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-[0.8125rem] text-fg">{s.name}</p>
                      <ToneBadge meta={s.enabled ? { label: "Active", tone: "success" } : { label: "Paused", tone: "neutral" }} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{s.cron}</span> · next {formatDateTime(s.nextRunAt)}
                      {s.lastRunAt ? ` · last ${formatDateTime(s.lastRunAt)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          eyebrow="Delivery log"
          title="Email and WhatsApp deliveries"
          description="Every outbound message with its provider message id and the last error. Addresses are partially masked."
          bodyClassName="space-y-5"
        >
          <FilterChips
            label="Delivery status"
            param="delivery"
            pathname="/admin/jobs"
            searchParams={sp}
            allLabel="All"
            options={DELIVERY_FILTERS.map((s) => ({ value: s, label: DELIVERY_STATUS[s].label, count: deliveries.counts[s] ?? 0 }))}
          />
          {deliveries.deliveries.length === 0 ? (
            <Empty icon={Send} title="No deliveries" description="Messages appear here as soon as they are queued." />
          ) : (
            <DataTable minWidth={980} dense>
              <thead>
                <tr>
                  <Th>Queued</Th>
                  <Th>Channel</Th>
                  <Th>Event</Th>
                  <Th>Recipient</Th>
                  <Th>Status</Th>
                  <Th>Provider id</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.deliveries.map((d) => (
                  <Tr key={d.id}>
                    <Td className="text-[0.8125rem] whitespace-nowrap">{formatDateTime(d.createdAt)}</Td>
                    <Td className="text-[0.8125rem]">{d.channel === "EMAIL" ? "Email" : d.channel === "WHATSAPP" ? "WhatsApp" : "In-app"}</Td>
                    <Td className="font-mono text-[0.75rem] text-fg">{d.event}</Td>
                    <Td className="text-[0.8125rem]">{d.recipient}</Td>
                    <Td>
                      <ToneBadge meta={DELIVERY_STATUS[d.status]} />
                      {d.attempts > 1 && <span className="ml-2 text-[0.6875rem] text-muted-foreground">{d.attempts} attempts</span>}
                    </Td>
                    <Td>
                      <p className="max-w-[12rem] truncate font-mono text-[0.6875rem] text-fg-muted" title={d.providerMessageId ?? undefined}>
                        {d.provider ? `${d.provider} · ` : ""}
                        {d.providerMessageId ?? "—"}
                      </p>
                    </Td>
                    <Td>
                      <p className="line-clamp-2 max-w-[16rem] text-[0.75rem] leading-relaxed break-words text-fg-muted" title={d.error ?? undefined}>
                        {d.error ?? "—"}
                      </p>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>

        <Note icon={History}>Retries and cancellations are written to the audit log under your name. Jobs that succeed are removed after the retention period; dead-lettered jobs are kept until you act on them.</Note>
      </div>
    </>
  );
}
