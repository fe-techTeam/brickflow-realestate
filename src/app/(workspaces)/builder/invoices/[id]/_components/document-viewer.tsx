import { Download, ExternalLink, FileText } from "lucide-react";
import { EmptyState, Section } from "@/components/common/panels";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export interface ViewerDocument {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const documentUrl = (id: string) => `/api/documents/invoices/${id}`;

/** Inline PDF of the latest invoice document, with open/download actions, a mobile fallback and earlier versions. */
export function DocumentViewer({ documents, invoiceNumber }: { documents: ViewerDocument[]; invoiceNumber: string }) {
  const [latest, ...earlier] = documents;
  if (!latest) {
    return (
      <Section title="Invoice document">
        <EmptyState icon={FileText} title="No document attached" description="The channel partner has not attached a PDF to this invoice." className="py-8" />
      </Section>
    );
  }
  const url = documentUrl(latest.id);

  return (
    <Section
      title="Invoice document"
      description={`${latest.fileName} · ${formatSize(latest.sizeBytes)} · uploaded ${formatDateTime(latest.createdAt)}`}
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Open
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`${url}?download=1`} download={latest.fileName}>
              <Download className="size-3.5" />
              Download
            </a>
          </Button>
        </>
      }
      bodyClassName="p-0 sm:p-0"
    >
      <div className="hidden bg-ivory-200/60 md:block">
        <object data={`${url}#navpanes=0&view=FitH`} type="application/pdf" title={`Invoice ${invoiceNumber} PDF`} className="block h-[760px] w-full">
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <FileText className="size-8 text-gold-600" strokeWidth={1.5} />
            <p className="text-sm text-slate-ink">This browser cannot display the PDF inline.</p>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open {latest.fileName}
              </a>
            </Button>
          </div>
        </object>
      </div>

      <div className="flex items-center gap-4 px-5 py-5 md:hidden">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-ivory-200 text-gold-600 ring-1 ring-gold/20">
          <FileText className="size-5" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-navy">{latest.fileName}</p>
          <p className="text-xs text-muted-foreground">PDF · {formatSize(latest.sizeBytes)}</p>
        </div>
        <Button size="sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            View PDF
          </a>
        </Button>
      </div>

      {earlier.length > 0 && (
        <div className="border-t border-border/80 px-5 py-4 sm:px-6">
          <p className="eyebrow mb-2">Earlier versions</p>
          <ul className="space-y-1.5">
            {earlier.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <a href={documentUrl(doc.id)} target="_blank" rel="noopener noreferrer" className="text-navy underline-offset-4 hover:underline">
                  {doc.fileName}
                </a>
                <span className="text-xs text-muted-foreground">
                  Replaced · uploaded {formatDateTime(doc.createdAt)} · {formatSize(doc.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
