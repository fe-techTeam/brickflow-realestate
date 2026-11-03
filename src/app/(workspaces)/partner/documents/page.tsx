import type { Metadata } from "next";
import Link from "next/link";
import { Download, Eye, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoClock, resolveDemoDataset } from "@/lib/demo/catalogue";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listPartnerDocuments } from "@/server/queries/partner";
import { Money } from "../_components/money";
import { RefCell, Table, Td, Th, Tr } from "../_components/table";
import { EmptyNote, PageIntro, Panel, StatusMark } from "../_components/ui";

export const metadata: Metadata = { title: "Documents" };

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PdfGlyph({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-11 w-9 shrink-0 flex-col items-center justify-end rounded-[4px] border border-line bg-card pb-1 shadow-[0_2px_0_rgba(255,255,255,0.08)]", className)}>
      <span aria-hidden="true" className="absolute top-0 right-0 size-2.5 rounded-bl-[3px] border-b border-l border-line bg-glass-100" />
      <FileText className="mb-0.5 size-3.5 text-fg/60" strokeWidth={1.5} />
      <span className="text-[0.5rem] font-bold tracking-wider text-danger">PDF</span>
    </span>
  );
}

export default async function DocumentsPage() {
  const actor = await requireWorkspace("partner");
  const documents = await listPartnerDocuments(actor);
  const dataset = resolveDemoDataset();
  const samples = dataset.samples(demoClock());
  const latestByInvoice = new Set<string>();
  const current = new Set<string>();
  for (const doc of documents) {
    if (latestByInvoice.has(doc.invoiceId)) continue;
    latestByInvoice.add(doc.invoiceId);
    current.add(doc.id);
  }

  return (
    <>
      <PageIntro eyebrow="Account" title="Documents" description="Sample invoices for the demonstration, and every invoice PDF your organisation has uploaded." />

      <div className="flex flex-col gap-6">
        <Panel eyebrow="Try the upload flow" title="Sample documents" description="Fictional GST brokerage invoices for extraction and submission">
          <ul className={cn("grid gap-5", samples.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
            {samples.map((sample) => {
              const builder = dataset.organisations[sample.builder];
              const project = dataset.projects.find((p) => p.key === sample.project);
              return (
                <li key={sample.slug} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-[0_20px_40px_-28px_rgba(8, 14, 24,0.35)]">
                  <div className="relative border-b border-hairline bg-glass-100 px-5 pt-5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <PdfGlyph />
                      <span className="rounded-full border border-line-strong/40 px-2 py-0.5 text-[0.5625rem] font-semibold tracking-[0.16em] text-fg-muted uppercase">Sample</span>
                    </div>
                    <p className="mt-4 font-display text-[1.25rem] leading-snug font-normal text-fg">{sample.invoiceNumber}</p>
                    <p className="mt-0.5 line-clamp-2 text-[0.8125rem] text-fg-soft">{sample.title}</p>
                  </div>
                  <dl className="grid gap-2 px-5 py-4 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Bill to</dt>
                      <dd className="text-right text-fg">{builder?.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Project</dt>
                      <dd className="text-right text-fg">{project?.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Invoice date</dt>
                      <dd className="text-right text-fg">{formatDate(new Date(`${sample.invoiceDate}T00:00:00.000Z`))}</dd>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
                      <dt className="text-muted-foreground">Total incl. GST</dt>
                      <dd>
                        <Money paise={sample.amountPaise} className="text-sm font-semibold text-fg" />
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-auto grid grid-cols-2 gap-2 px-5 pb-5">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/documents/samples/${sample.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`View sample ${sample.invoiceNumber}`}>
                        <Eye />
                        View
                      </a>
                    </Button>
                    <Button size="sm" asChild>
                      <a href={`/api/documents/samples/${sample.slug}?download=1`} download aria-label={`Download sample ${sample.invoiceNumber}`}>
                        <Download />
                        Download
                      </a>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel
          eyebrow="Secure storage"
          title="Uploaded invoice documents"
          description={`${documents.length} ${documents.length === 1 ? "file" : "files"} across your invoices`}
          bodyClassName="pb-0"
        >
          {documents.length === 0 ? (
            <div className="-mx-5 border-t border-hairline sm:-mx-7">
              <EmptyNote
                icon={FolderOpen}
                title="No documents uploaded yet"
                description="Invoice PDFs you upload are stored securely and listed here."
                action={
                  <Button size="sm" asChild>
                    <Link href="/partner/invoices/new">Upload invoice</Link>
                  </Button>
                }
              />
            </div>
          ) : (
            <Table minWidth={940}>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Invoice</Th>
                  <Th>Builder · Project</Th>
                  <Th>Status</Th>
                  <Th>Uploaded</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <Tr key={doc.id}>
                    <Td>
                      <div className="flex items-center gap-3.5">
                        <PdfGlyph className="h-10 w-8" />
                        <div className="min-w-0">
                          <p className="max-w-[15rem] truncate font-medium text-fg" title={doc.fileName}>
                            {doc.fileName}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatBytes(doc.sizeBytes)} ·{" "}
                            <span className={current.has(doc.id) ? "text-leaf" : undefined}>{current.has(doc.id) ? "Current version" : "Previous version"}</span>
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <RefCell href={`/partner/invoices/${doc.invoice.id}`} primary={doc.invoice.invoiceNumber} secondary={doc.invoice.reference} code />
                    </Td>
                    <Td>
                      <p className="text-[0.8125rem] text-fg">{doc.invoice.builder.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{doc.invoice.project.name}</p>
                    </Td>
                    <Td>
                      <StatusMark kind="invoice" status={doc.invoice.status} />
                    </Td>
                    <Td className="text-[0.8125rem] whitespace-nowrap">{formatDateTime(doc.createdAt)}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" asChild className="bg-card">
                          <a href={`/api/documents/invoices/${doc.id}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${doc.fileName}`}>
                            <Eye />
                            View
                          </a>
                        </Button>
                        <Button variant="ghost" size="icon-sm" asChild className="text-muted-foreground hover:text-fg">
                          <a href={`/api/documents/invoices/${doc.id}?download=1`} download aria-label={`Download ${doc.fileName}`}>
                            <Download />
                          </a>
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
