import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, ShieldCheck, TriangleAlert } from "lucide-react";
import { Money } from "@/components/common/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { agreedBrokeragePaise, applyBps, brokerageTolerancePaise, expectedSupplyMode, invoicedTaxablePaise } from "@/lib/invoice-integrity/consistency";
import { stateName } from "@/lib/invoice-integrity/gst";
import { MATCH_ITEMS, type MatchAttestation } from "@/lib/invoice-integrity/match";
import { formatBps } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Invoice columns the particulars view reads. Server components pass the Prisma record directly. */
export interface BrokerageParticularsSource {
  amountPaise: bigint;
  gstAmountPaise: bigint | null;
  taxableValuePaise: bigint | null;
  cgstPaise: bigint | null;
  sgstPaise: bigint | null;
  igstPaise: bigint | null;
  gstRateBps: number | null;
  tdsRateBps: number | null;
  placeOfSupplyStateCode: string | null;
  supplierGstin: string | null;
  recipientGstin: string | null;
  bookingTower: string | null;
  bookingUnit: string | null;
  buyerInitials: string | null;
  agreementRegistrationNumber: string | null;
  agreementDate: Date | null;
  agreementValuePaise: bigint | null;
  agreementBrokerageBps: number | null;
  agreementBrokeragePaise: bigint | null;
  irn: string | null;
  eInvoiceAckNumber: string | null;
  eInvoiceAckDate: Date | null;
}

function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow mb-3 text-[0.625rem] text-fg-muted">{title}</p>
      <dl className="grid gap-y-2.5">{children}</dl>
    </div>
  );
}

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-3 text-[0.8125rem]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right text-fg [overflow-wrap:anywhere] sm:text-left", mono && "font-mono text-[0.75rem]")}>{children}</dd>
    </div>
  );
}

function Missing({ children = "Not stated" }: { children?: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function towerLabel(tower: string): string {
  return /^(wing|block|phase|tower)\b/i.test(tower) ? tower : `Tower ${tower}`;
}

/** Booking, agreement, GST and e-invoice particulars of a brokerage invoice, with the platform's arithmetic checks. */
export function BrokerageParticulars({ invoice, className }: { invoice: BrokerageParticularsSource; className?: string }) {
  const taxable = invoicedTaxablePaise({ taxableValuePaise: invoice.taxableValuePaise, totalPaise: invoice.amountPaise, gstAmountPaise: invoice.gstAmountPaise });
  const agreed = agreedBrokeragePaise(invoice);
  const brokerageGap = taxable !== null && agreed !== null ? (taxable > agreed ? taxable - agreed : agreed - taxable) : null;
  const brokerageOk = brokerageGap !== null && agreed !== null ? brokerageGap <= brokerageTolerancePaise(agreed) : null;
  const mode = expectedSupplyMode(invoice);
  const hasSplit = invoice.cgstPaise !== null || invoice.sgstPaise !== null || invoice.igstPaise !== null;
  const tds = taxable !== null && invoice.tdsRateBps !== null ? applyBps(taxable, invoice.tdsRateBps) : null;
  const pos = invoice.placeOfSupplyStateCode;

  return (
    <div className={cn("grid gap-x-10 gap-y-8 md:grid-cols-2", className)}>
      <Group title="Booking">
        <Row label="Tower / unit">
          {invoice.bookingTower || invoice.bookingUnit ? [invoice.bookingTower && towerLabel(invoice.bookingTower), invoice.bookingUnit && `Unit ${invoice.bookingUnit}`].filter(Boolean).join(" · ") : <Missing />}
        </Row>
        <Row label="Buyer">{invoice.buyerInitials ? <span title="Initials only">{invoice.buyerInitials}</span> : <Missing />}</Row>
      </Group>

      <Group title="Agreement for sale">
        <Row label="Registration no." mono={Boolean(invoice.agreementRegistrationNumber)}>
          {invoice.agreementRegistrationNumber ?? <Missing />}
        </Row>
        <Row label="Registered on">{invoice.agreementDate ? formatDate(invoice.agreementDate) : <Missing />}</Row>
        <Row label="Agreement value">{invoice.agreementValuePaise !== null ? <Money paise={invoice.agreementValuePaise} /> : <Missing />}</Row>
        <Row label="Brokerage stated">
          {invoice.agreementBrokerageBps === null && invoice.agreementBrokeragePaise === null ? (
            <Missing />
          ) : (
            <>
              {invoice.agreementBrokerageBps !== null && <span>{formatBps(invoice.agreementBrokerageBps)}</span>}
              {invoice.agreementBrokerageBps !== null && agreed !== null && <span className="text-muted-foreground"> · </span>}
              {agreed !== null && <Money paise={agreed} />}
            </>
          )}
        </Row>
        {brokerageOk !== null && (
          <p className={cn("flex items-start gap-1.5 pt-1 text-xs", brokerageOk ? "text-leaf" : "text-warning")}>
            {brokerageOk ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <TriangleAlert className="mt-px size-3.5 shrink-0" />}
            {brokerageOk ? "Invoiced taxable value agrees with the agreement's brokerage" : "Invoiced taxable value differs from the agreement's brokerage by more than 1%"}
          </p>
        )}
      </Group>

      <Group title="Tax">
        <Row label="Taxable value">{taxable !== null ? <Money paise={taxable} /> : <Missing />}</Row>
        {hasSplit ? (
          <>
            {(invoice.cgstPaise ?? 0n) > 0n || (invoice.sgstPaise ?? 0n) > 0n ? (
              <>
                <Row label="CGST">
                  <Money paise={invoice.cgstPaise ?? 0n} />
                </Row>
                <Row label="SGST">
                  <Money paise={invoice.sgstPaise ?? 0n} />
                </Row>
              </>
            ) : null}
            {(invoice.igstPaise ?? 0n) > 0n && (
              <Row label="IGST">
                <Money paise={invoice.igstPaise!} />
              </Row>
            )}
          </>
        ) : (
          <Row label="GST">{invoice.gstAmountPaise !== null ? <Money paise={invoice.gstAmountPaise} /> : <Missing />}</Row>
        )}
        <Row label="GST rate">{invoice.gstRateBps !== null ? formatBps(invoice.gstRateBps) : <Missing />}</Row>
        <Row label="Place of supply">{pos ? `${stateName(pos) ?? "Unknown"} (${pos})` : <Missing />}</Row>
        <Row label="Supply">{mode === "INTRA" ? "Intra-state · CGST + SGST" : mode === "INTER" ? "Inter-state · IGST" : <Missing>GSTIN not on file</Missing>}</Row>
        <Row label="TDS expected">
          {invoice.tdsRateBps !== null ? (
            <>
              {formatBps(invoice.tdsRateBps)}
              {tds !== null && (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <Money paise={tds} />
                </>
              )}
            </>
          ) : (
            <Missing />
          )}
        </Row>
      </Group>

      <Group title="E-invoice">
        {invoice.irn ? (
          <>
            <Row label="IRN" mono>
              <span className="break-all">{invoice.irn}</span>
            </Row>
            <Row label="Ack no." mono={Boolean(invoice.eInvoiceAckNumber)}>
              {invoice.eInvoiceAckNumber ?? <Missing />}
            </Row>
            <Row label="Ack date">{invoice.eInvoiceAckDate ? formatDate(invoice.eInvoiceAckDate) : <Missing />}</Row>
            <p className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              IRN format verified. Registration on the IRP is confirmed separately.
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
            <CircleDashed className="mt-0.5 size-4 shrink-0" />
            No IRN stated. E-invoicing applies only to suppliers above the turnover threshold.
          </p>
        )}
      </Group>
    </div>
  );
}

/** Reads the stored attestation JSON defensively; older approvals have none. */
export function parseMatchAttestation(value: unknown): MatchAttestation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MatchAttestation>;
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) return null;
  return candidate as MatchAttestation;
}

/** The builder's three-way match attestation recorded with an approval. */
export function MatchAttestationSummary({
  attestation,
  attestedByName,
  attestedAt,
  className,
}: {
  attestation: unknown;
  attestedByName: string | null;
  attestedAt: Date | null;
  className?: string;
}) {
  const parsed = parseMatchAttestation(attestation);
  if (!parsed) return null;
  const ticked = new Set(parsed.items.map((i) => i.key));
  return (
    <div className={cn("rounded-lg border hairline bg-glass-100/70 px-4 py-3.5", className)}>
      <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
        <ShieldCheck className="size-4 text-leaf" />
        Three-way match attested
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {attestedByName ?? "Builder"}
        {attestedAt ? ` · ${formatDateTime(attestedAt)}` : ""}
        {parsed.required ? "" : " · optional for this programme"}
      </p>
      <ul className="mt-3 grid gap-1.5 text-xs">
        {MATCH_ITEMS.map((item) => {
          const entry = parsed.items.find((i) => i.key === item.key);
          return (
            <li key={item.key} className={cn("flex items-start gap-1.5", ticked.has(item.key) ? "text-fg-soft" : "text-muted-foreground")}>
              {ticked.has(item.key) ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-leaf" /> : <CircleDashed className="mt-px size-3.5 shrink-0" />}
              <span className="min-w-0">
                <span className="font-medium">{item.label}</span>
                {entry ? <span className="text-muted-foreground"> · {entry.invoiceValue}</span> : " · not attested"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
