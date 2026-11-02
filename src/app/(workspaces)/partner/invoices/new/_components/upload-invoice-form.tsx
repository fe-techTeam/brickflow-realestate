"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, Eye, FileText, Loader2, Lock, ScanText, Send, Sparkles, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { matchBuilder, matchProject, parseInvoiceText, type ExtractedInvoiceFields } from "@/lib/extraction/invoice-fields";
import { formatINR, parseRupeesToPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { submitInvoiceAction } from "@/server/actions/invoices";
import { extractPdfText } from "./pdf-text";

export interface UploadBuilder {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  creditPeriodDays: number;
  projects: { id: string; name: string; code: string; city: string }[];
}

type FieldName = "builderId" | "projectId" | "invoiceNumber" | "invoiceDate" | "dueDate" | "amount" | "gstAmount" | "description";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName | "file", string>>;

type Extraction =
  | { status: "idle" }
  | { status: "running"; progress: number; message: string }
  | { status: "done"; method: "text" | "ocr"; fields: ExtractedInvoiceFields; filled: FieldName[]; builderMatch: "gstin" | "name" | null }
  | { status: "failed"; message: string };

const EMPTY: Values = { builderId: "", projectId: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", gstAmount: "", description: "" };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PAISE = 100_00_00_000_00n;
const FIELD_ORDER: (FieldName | "file")[] = ["file", "builderId", "projectId", "invoiceNumber", "invoiceDate", "dueDate", "amount", "gstAmount", "description"];

function validate(values: Values, file: File | null, today: string): Errors {
  const errors: Errors = {};
  if (!file) errors.file = "Attach the invoice PDF";
  else if (file.size === 0) errors.file = "The selected file is empty";
  else if (file.size > MAX_BYTES) errors.file = "The PDF must be 10 MB or smaller";
  else if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) errors.file = "Only PDF documents are accepted";

  if (!values.builderId) errors.builderId = "Select a builder";
  if (!values.projectId) errors.projectId = "Select a project";

  const number = values.invoiceNumber.trim();
  if (number.length < 3) errors.invoiceNumber = "Invoice number is required";
  else if (number.length > 40) errors.invoiceNumber = "Invoice number is too long";
  else if (!/^[A-Za-z0-9/_.-]+$/.test(number)) errors.invoiceNumber = "Use letters, numbers and / - _ . only";

  if (!values.invoiceDate) errors.invoiceDate = "Enter the invoice date";
  else if (values.invoiceDate > today) errors.invoiceDate = "Invoice date cannot be in the future";
  if (values.dueDate && values.invoiceDate && values.dueDate < values.invoiceDate) errors.dueDate = "Due date must be on or after the invoice date";

  const amount = values.amount.trim() ? parseRupeesToPaise(values.amount) : null;
  if (!values.amount.trim()) errors.amount = "Invoice amount is required";
  else if (amount === null) errors.amount = "Enter a number with up to 2 decimals";
  else if (amount <= 0n) errors.amount = "Invoice amount must be greater than zero";
  else if (amount > MAX_TOTAL_PAISE) errors.amount = "Invoice amount exceeds the ₹100 crore limit";

  if (values.gstAmount.trim()) {
    const gst = parseRupeesToPaise(values.gstAmount);
    if (gst === null) errors.gstAmount = "Enter a number with up to 2 decimals";
    else if (amount !== null && gst >= amount) errors.gstAmount = "GST must be less than the invoice total";
  }
  if (values.description.trim().length > 500) errors.description = "Keep the description under 500 characters";
  return errors;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function money(value: string | undefined): string {
  if (!value) return "—";
  const paise = parseRupeesToPaise(value);
  return paise === null ? value : formatINR(paise);
}

export function UploadInvoiceForm({ builders, partnerGstin, today }: { builders: UploadBuilder[]; partnerGstin: string | null; today: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [extraction, setExtraction] = useState<Extraction>({ status: "idle" });
  const [extracted, setExtracted] = useState<Set<FieldName>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const touched = useRef<Set<FieldName>>(new Set());
  const run = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const latestValues = useRef<Values>(EMPTY);

  useEffect(() => {
    latestValues.current = values;
  }, [values]);

  const builder = useMemo(() => builders.find((b) => b.id === values.builderId) ?? null, [builders, values.builderId]);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function setField(name: FieldName, value: string) {
    touched.current.add(name);
    setValues((current) => {
      const next = { ...current, [name]: value };
      if (name === "builderId" && current.builderId !== value) {
        const target = builders.find((b) => b.id === value);
        next.projectId = target && target.projects.length === 1 ? target.projects[0]!.id : "";
      }
      return next;
    });
    setExtracted((current) => {
      if (!current.has(name)) return current;
      const next = new Set(current);
      next.delete(name);
      return next;
    });
    setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
  }

  async function runExtraction(selected: File) {
    const id = ++run.current;
    setExtraction({ status: "running", progress: 0.02, message: "Preparing" });
    try {
      const { text, method } = await extractPdfText(selected, (p) => {
        if (run.current === id) setExtraction({ status: "running", progress: p.progress, message: p.message });
      });
      if (run.current !== id) return;
      const fields = parseInvoiceText(text);
      const match = matchBuilder(fields, builders);
      const matchedBuilder = match ? builders.find((b) => b.id === match.id) : undefined;
      const projectId = matchedBuilder ? matchProject(text, matchedBuilder.projects) : null;

      const proposed: Partial<Values> = {
        invoiceNumber: fields.invoiceNumber,
        invoiceDate: fields.invoiceDate,
        dueDate: fields.dueDate,
        amount: fields.totalAmount,
        gstAmount: fields.taxAmount,
      };
      if (matchedBuilder) {
        proposed.builderId = matchedBuilder.id;
        proposed.projectId = projectId ?? (matchedBuilder.projects.length === 1 ? matchedBuilder.projects[0]!.id : undefined);
      }

      const current = latestValues.current;
      const next = { ...current };
      const filled: FieldName[] = [];
      for (const [key, value] of Object.entries(proposed) as [FieldName, string | undefined][]) {
        if (!value || touched.current.has(key)) continue;
        if (key === "projectId" && touched.current.has("builderId") && current.builderId !== proposed.builderId) continue;
        next[key] = value;
        filled.push(key);
      }
      if (filled.includes("builderId") && !filled.includes("projectId") && !touched.current.has("projectId")) next.projectId = "";
      setValues(next);
      setExtracted(new Set(filled));
      setErrors((current) => {
        const next = { ...current };
        for (const key of filled) delete next[key];
        return next;
      });
      setExtraction({ status: "done", method, fields, filled, builderMatch: match?.by ?? null });
      if (filled.length) toast.success(`Pre-filled ${filled.length} ${filled.length === 1 ? "field" : "fields"} from the document. Please verify them.`);
      else toast.info("We couldn't recognise invoice details in this document. Please enter them manually.");
    } catch (error) {
      if (run.current !== id) return;
      console.warn("[upload] extraction failed", error);
      setExtraction({ status: "failed", message: "We couldn't read this document automatically. Enter the details manually — your upload is not affected." });
    }
  }

  function acceptFile(selected: File | undefined | null) {
    if (!selected) return;
    setFile(selected);
    setFormError(null);
    const problem = validate(values, selected, today).file;
    setErrors((current) => ({ ...current, file: problem }));
    if (problem) {
      setExtraction({ status: "idle" });
      return;
    }
    void runExtraction(selected);
  }

  function clearFile() {
    run.current += 1;
    setFile(null);
    setExtraction({ status: "idle" });
    setExtracted(new Set());
    if (fileInput.current) fileInput.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  function focusFirst(found: Errors) {
    const first = FIELD_ORDER.find((key) => found[key]);
    if (!first) return;
    const target = document.getElementById(first === "file" ? "invoice-file" : `field-${first}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const found = validate(values, file, today);
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      focusFirst(found);
      toast.error("Please correct the highlighted fields.");
      return;
    }
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value.trim());
    formData.set("file", file!);
    startSubmit(async () => {
      const result = await submitInvoiceAction(formData);
      if (!result.ok) {
        const mapped: Errors = {};
        for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (key in EMPTY || key === "file") mapped[key as FieldName | "file"] = messages[0];
        }
        setErrors(mapped);
        setFormError(result.error);
        focusFirst(mapped);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Invoice submitted.", { description: `Reference ${result.data.reference}` });
      router.push(`/partner/invoices/${result.data.id}`);
    });
  }

  const amountPaise = values.amount.trim() ? parseRupeesToPaise(values.amount) : null;
  const gstPaise = values.gstAmount.trim() ? parseRupeesToPaise(values.gstAmount) : null;
  const busy = submitting;

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <FormSection step="1" title="Invoice document" description="Upload the signed tax invoice PDF. We read it in your browser to pre-fill the form.">
          {file ? (
            <div className={cn("flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center", errors.file ? "border-destructive/50 bg-[#f8e7e4]/40" : "border-border bg-ivory/50")}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-navy text-gold">
                <FileText className="size-5" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-navy">{file.name}</p>
                <p className="text-xs text-muted-foreground">PDF · {formatBytes(file.size)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {previewUrl && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                      <Eye />
                      Preview
                    </a>
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                  Replace
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearFile} disabled={busy} aria-label="Remove file">
                  <X />
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <label
              htmlFor="invoice-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragging ? "border-gold bg-gold-100/50" : errors.file ? "border-destructive/50 bg-[#f8e7e4]/30" : "border-input bg-ivory/40 hover:border-gold/60 hover:bg-ivory",
              )}
            >
              <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-card text-gold-600 ring-1 ring-gold/30">
                <UploadCloud className="size-5" strokeWidth={1.6} />
              </span>
              <span className="text-sm font-medium text-navy">Drop your invoice PDF here, or browse</span>
              <span className="mt-1 text-xs text-muted-foreground">PDF only · up to 10 MB · scanned invoices are supported</span>
            </label>
          )}
          <input
            ref={fileInput}
            id="invoice-file"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-invalid={Boolean(errors.file)}
            aria-describedby={errors.file ? "invoice-file-error" : undefined}
            onChange={(e) => acceptFile(e.target.files?.[0])}
          />
          {errors.file && (
            <p id="invoice-file-error" role="alert" className="mt-2 text-xs text-destructive">
              {errors.file}
            </p>
          )}
        </FormSection>

        <FormSection step="2" title="Builder & project" description="Only builders you are empanelled with are listed.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="builderId" label="Builder" required error={errors.builderId} extracted={extracted.has("builderId")} hint={builder ? `${builder.creditPeriodDays}-day credit period` : undefined}>
              <Select value={values.builderId} onValueChange={(v) => setField("builderId", v)} disabled={busy}>
                <SelectTrigger id="field-builderId" className="h-10 w-full bg-card" aria-invalid={Boolean(errors.builderId)}>
                  <SelectValue placeholder="Select builder" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {builders.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="projectId" label="Project" required error={errors.projectId} extracted={extracted.has("projectId")}>
              <Select value={values.projectId} onValueChange={(v) => setField("projectId", v)} disabled={busy || !builder}>
                <SelectTrigger id="field-projectId" className="h-10 w-full bg-card" aria-invalid={Boolean(errors.projectId)}>
                  <SelectValue placeholder={builder ? "Select project" : "Select a builder first"} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {builder?.projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {builders.length === 0 && (
            <p className="mt-4 rounded-md bg-[#fbf1df] px-3 py-2 text-xs text-[#8a5a12]">
              You are not currently empanelled with any active builder. Contact the platform administrator to be added.
            </p>
          )}
        </FormSection>

        <FormSection step="3" title="Invoice details" description="Amounts are in Indian rupees. The invoice amount is the total including GST.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="invoiceNumber" label="Invoice number" required error={errors.invoiceNumber} extracted={extracted.has("invoiceNumber")} className="sm:col-span-2">
              <Input
                id="field-invoiceNumber"
                value={values.invoiceNumber}
                onChange={(e) => setField("invoiceNumber", e.target.value)}
                placeholder="e.g. GFH/2026/004"
                autoComplete="off"
                maxLength={40}
                className="h-10 bg-card"
                aria-invalid={Boolean(errors.invoiceNumber)}
                disabled={busy}
              />
            </Field>
            <Field id="invoiceDate" label="Invoice date" required error={errors.invoiceDate} extracted={extracted.has("invoiceDate")}>
              <Input
                id="field-invoiceDate"
                type="date"
                value={values.invoiceDate}
                max={today}
                onChange={(e) => setField("invoiceDate", e.target.value)}
                className="h-10 bg-card"
                aria-invalid={Boolean(errors.invoiceDate)}
                disabled={busy}
              />
            </Field>
            <Field
              id="dueDate"
              label="Due date"
              error={errors.dueDate}
              extracted={extracted.has("dueDate")}
              hint={builder ? `Optional. If blank, the ${builder.creditPeriodDays}-day credit period applies.` : "Optional"}
            >
              <Input
                id="field-dueDate"
                type="date"
                value={values.dueDate}
                min={values.invoiceDate || undefined}
                onChange={(e) => setField("dueDate", e.target.value)}
                className="h-10 bg-card"
                aria-invalid={Boolean(errors.dueDate)}
                disabled={busy}
              />
            </Field>
            <Field
              id="amount"
              label="Invoice amount (incl. GST)"
              required
              error={errors.amount}
              extracted={extracted.has("amount")}
              hint={amountPaise !== null && amountPaise > 0n ? formatINR(amountPaise) : "Total payable as per the invoice"}
            >
              <AmountInput id="field-amount" value={values.amount} onChange={(v) => setField("amount", v)} invalid={Boolean(errors.amount)} disabled={busy} />
            </Field>
            <Field
              id="gstAmount"
              label="GST amount"
              error={errors.gstAmount}
              extracted={extracted.has("gstAmount")}
              hint={
                gstPaise !== null && amountPaise !== null && gstPaise < amountPaise
                  ? `Taxable value ${formatINR(amountPaise - gstPaise)}`
                  : "Optional. Tax included in the invoice amount"
              }
            >
              <AmountInput id="field-gstAmount" value={values.gstAmount} onChange={(v) => setField("gstAmount", v)} invalid={Boolean(errors.gstAmount)} disabled={busy} />
            </Field>
            <Field id="description" label="Description" error={errors.description} hint={`${values.description.length}/500`} className="sm:col-span-2">
              <Textarea
                id="field-description"
                value={values.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="e.g. Brokerage on sale of units B-1104 and B-1202, Tower B"
                rows={3}
                maxLength={500}
                className="bg-card"
                aria-invalid={Boolean(errors.description)}
                disabled={busy}
              />
            </Field>
          </div>
        </FormSection>

        {formError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#ecc6bf] bg-[#f8e7e4] px-4 py-3 text-sm text-[#93342a]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">By submitting you confirm this invoice is genuine and raised under your empanelment agreement.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => router.push("/partner/invoices")} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Submit for approval
            </Button>
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
        <ExtractionPanel extraction={extraction} builder={builder} partnerGstin={partnerGstin} />
        <div className="surface p-5">
          <p className="eyebrow mb-3">What happens next</p>
          <ol className="grid gap-3 text-sm">
            {[
              ["Builder review", "The builder's accounts team approves, rejects or asks for clarification."],
              ["Early payment", "Once approved, get the discounted amount at your builder's agreed rate."],
              ["Payout", "Veefin approves and pays the net amount to your bank account (simulated)."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy font-display text-xs font-semibold text-gold">{i + 1}</span>
                <span>
                  <span className="block font-medium text-navy">{title}</span>
                  <span className="text-xs text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </form>
  );
}

function FormSection({ step, title, description, children }: { step: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="surface animate-fade-up overflow-hidden">
      <header className="flex items-start gap-3 border-b border-border/80 px-5 py-4 sm:px-6">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/50 font-display text-sm font-semibold text-gold-600">{step}</span>
        <div>
          <h2 className="font-display text-xl leading-tight font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  required,
  error,
  hint,
  extracted,
  className,
  children,
}: {
  id: FieldName;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  extracted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`field-${id}`}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        {extracted && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[0.625rem] font-semibold text-gold-600 ring-1 ring-gold/30 ring-inset">
            <Sparkles className="size-3" />
            Extracted — please verify
          </span>
        )}
      </div>
      <div className={cn(extracted && "rounded-lg ring-2 ring-gold/25")}>{children}</div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="tabular text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function AmountInput({ id, value, onChange, invalid, disabled }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; disabled: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="tabular h-10 bg-card pl-7"
        aria-invalid={invalid}
        disabled={disabled}
      />
    </div>
  );
}

function ExtractionPanel({ extraction, builder, partnerGstin }: { extraction: Extraction; builder: UploadBuilder | null; partnerGstin: string | null }) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
        <div className="flex items-center gap-2">
          <ScanText className="size-4 text-gold-600" />
          <p className="font-display text-lg font-semibold text-navy">Smart extraction</p>
        </div>
        {extraction.status === "done" && (
          <span className="rounded-full bg-sage px-2 py-0.5 text-[0.625rem] font-semibold text-heritage">{extraction.method === "ocr" ? "OCR · scanned" : "Text layer"}</span>
        )}
      </div>
      <div className="px-5 py-4 text-sm" aria-live="polite">
        {extraction.status === "idle" && (
          <p className="flex items-start gap-2 text-muted-foreground">
            <CircleDashed className="mt-0.5 size-4 shrink-0" />
            Choose a PDF and we&apos;ll read the invoice number, dates, parties, GSTINs and amounts for you to verify.
          </p>
        )}
        {extraction.status === "running" && (
          <div className="grid gap-2">
            <p className="flex items-center gap-2 font-medium text-navy">
              <Loader2 className="size-4 animate-spin text-gold-600" />
              {extraction.message}
            </p>
            <Progress value={Math.round(extraction.progress * 100)} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-gold" aria-label="Extraction progress" />
            <p className="text-xs text-muted-foreground">You can keep filling in the form while this runs.</p>
          </div>
        )}
        {extraction.status === "failed" && (
          <p className="flex items-start gap-2 text-[#8a5a12]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {extraction.message}
          </p>
        )}
        {extraction.status === "done" && <ExtractionSummary extraction={extraction} builder={builder} partnerGstin={partnerGstin} />}
      </div>
      <p className="flex items-start gap-2 border-t border-border/70 bg-ivory/60 px-5 py-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3 shrink-0" />
        Processed locally in your browser. The document is not sent to any external service for extraction.
      </p>
    </div>
  );
}

function ExtractionSummary({
  extraction,
  builder,
  partnerGstin,
}: {
  extraction: Extract<Extraction, { status: "done" }>;
  builder: UploadBuilder | null;
  partnerGstin: string | null;
}) {
  const { fields } = extraction;
  const supplierMismatch = Boolean(partnerGstin && fields.supplierGstin && fields.supplierGstin !== partnerGstin);
  const builderGstinMismatch = Boolean(builder?.gstin && fields.builderGstin && fields.builderGstin !== builder.gstin);
  const rows: [string, string | undefined, boolean?][] = [
    ["Supplier", fields.supplierName],
    ["Supplier GSTIN", fields.supplierGstin],
    ["Bill to", fields.builderName],
    ["Builder GSTIN", fields.builderGstin],
    ["Taxable value", fields.taxableAmount && money(fields.taxableAmount), true],
    ["CGST", fields.cgstAmount && money(fields.cgstAmount), true],
    ["SGST", fields.sgstAmount && money(fields.sgstAmount), true],
    ["IGST", fields.igstAmount && money(fields.igstAmount), true],
    ["Total (incl. GST)", fields.totalAmount && money(fields.totalAmount), true],
  ];
  const shown = rows.filter(([, value]) => value);
  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2 text-heritage">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        {extraction.filled.length
          ? `${extraction.filled.length} ${extraction.filled.length === 1 ? "field" : "fields"} pre-filled. Review each highlighted field before submitting.`
          : "No form fields could be pre-filled. Please enter the details manually."}
      </p>
      {shown.length > 0 && (
        <dl className="grid gap-2 rounded-md border border-border/80 bg-ivory/40 p-3 text-xs">
          {shown.map(([label, value, numeric]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className={cn("min-w-0 text-right font-medium break-words text-navy", numeric && "tabular")}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="grid gap-1.5 text-xs">
        {extraction.builderMatch && (
          <li className="flex items-start gap-1.5 text-heritage">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" />
            Builder matched by {extraction.builderMatch === "gstin" ? "GSTIN" : "name"}.
          </li>
        )}
        {!extraction.builderMatch && (fields.builderName || fields.builderGstin) && (
          <li className="flex items-start gap-1.5 text-[#8a5a12]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            The billed builder doesn&apos;t match any builder you are empanelled with. Select it manually.
          </li>
        )}
        {fields.amountsReconcile === true && (
          <li className="flex items-start gap-1.5 text-heritage">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" />
            Taxable value and GST add up to the invoice total.
          </li>
        )}
        {fields.amountsReconcile === false && (
          <li className="flex items-start gap-1.5 text-[#8a5a12]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Taxable value and GST do not add up to the total. Check the amounts.
          </li>
        )}
        {supplierMismatch && (
          <li className="flex items-start gap-1.5 text-[#8a5a12]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Supplier GSTIN differs from your registered GSTIN ({partnerGstin}).
          </li>
        )}
        {builderGstinMismatch && (
          <li className="flex items-start gap-1.5 text-[#8a5a12]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Builder GSTIN on the invoice differs from {builder?.name}&apos;s registered GSTIN.
          </li>
        )}
      </ul>
    </div>
  );
}
