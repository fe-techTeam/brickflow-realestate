"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Calculator, CheckCircle2, CircleDashed, Eye, FileText, Loader2, Lock, ScanText, Send, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { matchBuilder, matchProject, parseInvoiceText, type ExtractedInvoiceFields } from "@/lib/extraction/invoice-fields";
import {
  AGREEMENT_NUMBER_PATTERN,
  agreedBrokeragePaise,
  BOOKING_TOWER_PATTERN,
  BOOKING_UNIT_PATTERN,
  brokerageTolerancePaise,
  BUYER_INITIALS_PATTERN,
  checkInvoiceConsistency,
  expectedSupplyMode,
  invoicedTaxablePaise,
  normaliseBuyerInitials,
  splitInclusiveTotal,
} from "@/lib/invoice-integrity/consistency";
import { GST_RATES_BPS, GST_STATE_CODES, gstinStateCode, stateName } from "@/lib/invoice-integrity/gst";
import { formatBps, formatINR, paiseToDecimalString, parsePercentToBps, parseRupeesToPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { submitInvoiceAction } from "@/server/actions/invoices";
import { Money } from "../../../_components/money";
import { ArchMotif } from "../../../_components/ui";
import { extractPdfText } from "./pdf-text";

export interface UploadBuilder {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  creditPeriodDays: number;
  projects: { id: string; name: string; code: string; city: string }[];
}

type DetailField =
  | "taxableValue"
  | "cgst"
  | "sgst"
  | "igst"
  | "gstRate"
  | "placeOfSupply"
  | "tdsRate"
  | "irn"
  | "ackNumber"
  | "ackDate"
  | "bookingTower"
  | "bookingUnit"
  | "buyerInitials"
  | "agreementRegistrationNumber"
  | "agreementDate"
  | "agreementValue"
  | "agreementBrokerageRate"
  | "agreementBrokerageAmount";
type FieldName = "builderId" | "projectId" | "invoiceNumber" | "invoiceDate" | "dueDate" | "amount" | "gstAmount" | "description" | DetailField;
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName | "file", string>>;

type Extraction =
  | { status: "idle" }
  | { status: "running"; progress: number; message: string }
  | { status: "done"; method: "text" | "ocr"; fields: ExtractedInvoiceFields; filled: FieldName[]; builderMatch: "gstin" | "name" | null }
  | { status: "failed"; message: string };

const DETAIL_FIELDS: DetailField[] = [
  "taxableValue",
  "cgst",
  "sgst",
  "igst",
  "gstRate",
  "placeOfSupply",
  "tdsRate",
  "irn",
  "ackNumber",
  "ackDate",
  "bookingTower",
  "bookingUnit",
  "buyerInitials",
  "agreementRegistrationNumber",
  "agreementDate",
  "agreementValue",
  "agreementBrokerageRate",
  "agreementBrokerageAmount",
];
const EMPTY: Values = {
  builderId: "",
  projectId: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  amount: "",
  gstAmount: "",
  description: "",
  ...(Object.fromEntries(DETAIL_FIELDS.map((f) => [f, ""])) as Record<DetailField, string>),
};
const AMOUNT_FIELDS: DetailField[] = ["taxableValue", "cgst", "sgst", "igst", "agreementValue", "agreementBrokerageAmount"];
const PERCENT_FIELDS: DetailField[] = ["gstRate", "tdsRate", "agreementBrokerageRate"];
const STATE_OPTIONS = Object.entries(GST_STATE_CODES).sort((a, b) => a[1].localeCompare(b[1]));
const AUTO = "auto";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PAISE = 100_00_00_000_00n;
const FIELD_ORDER: (FieldName | "file")[] = ["file", "builderId", "projectId", "invoiceNumber", "invoiceDate", "dueDate", "amount", "gstAmount", "description", ...DETAIL_FIELDS];

interface Parties {
  supplierGstin: string | null;
  recipientGstin: string | null;
}

const paiseOf = (value: string) => (value.trim() ? parseRupeesToPaise(value) : null);
const bpsOf = (value: string) => (value.trim() ? parsePercentToBps(value) : null);
const dateOf = (value: string) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

/** Format checks for the brokerage particulars, then the shared cross-field rules the server also enforces. */
function validateDetails(values: Values, today: string, parties: Parties, errors: Errors) {
  for (const field of AMOUNT_FIELDS) {
    if (values[field].trim() && parseRupeesToPaise(values[field]) === null) errors[field] = "Enter a number with up to 2 decimals";
  }
  for (const field of PERCENT_FIELDS) {
    if (values[field].trim() && parsePercentToBps(values[field]) === null) errors[field] = "Enter a percentage with up to 2 decimals";
  }
  if (values.bookingTower.trim() && !BOOKING_TOWER_PATTERN.test(values.bookingTower.trim())) errors.bookingTower = "Use up to 20 letters, numbers, spaces and . _ -";
  if (values.bookingUnit.trim() && !BOOKING_UNIT_PATTERN.test(values.bookingUnit.trim())) errors.bookingUnit = "Use up to 20 letters, numbers, spaces and / . _ -";
  if (values.buyerInitials.trim() && !BUYER_INITIALS_PATTERN.test(normaliseBuyerInitials(values.buyerInitials))) errors.buyerInitials = "Initials only, up to 4 letters";
  if (values.agreementRegistrationNumber.trim() && !AGREEMENT_NUMBER_PATTERN.test(values.agreementRegistrationNumber.trim()))
    errors.agreementRegistrationNumber = "Use 3–40 letters, numbers, spaces and / . _ -";

  const total = paiseOf(values.amount);
  if (!values.invoiceDate || total === null || Object.values(errors).some(Boolean)) return;
  const issues = checkInvoiceConsistency({
    today: new Date(`${today}T00:00:00.000Z`),
    invoiceDate: dateOf(values.invoiceDate)!,
    dueDate: dateOf(values.dueDate),
    totalPaise: total,
    gstAmountPaise: paiseOf(values.gstAmount),
    taxableValuePaise: paiseOf(values.taxableValue),
    cgstPaise: paiseOf(values.cgst),
    sgstPaise: paiseOf(values.sgst),
    igstPaise: paiseOf(values.igst),
    gstRateBps: bpsOf(values.gstRate),
    supplierGstin: parties.supplierGstin,
    recipientGstin: parties.recipientGstin,
    placeOfSupplyStateCode: values.placeOfSupply || null,
    agreementDate: dateOf(values.agreementDate),
    agreementValuePaise: paiseOf(values.agreementValue),
    agreementBrokerageBps: bpsOf(values.agreementBrokerageRate),
    agreementBrokeragePaise: paiseOf(values.agreementBrokerageAmount),
    tdsRateBps: bpsOf(values.tdsRate),
    irn: values.irn.trim() || null,
    eInvoiceAckNumber: values.ackNumber.trim() || null,
    eInvoiceAckDate: dateOf(values.ackDate),
  });
  for (const issue of issues) errors[issue.field] ??= issue.message;
}

function validate(values: Values, file: File | null, today: string, parties: Parties = { supplierGstin: null, recipientGstin: null }): Errors {
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
  validateDetails(values, today, parties, errors);
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
  const parties: Parties = { supplierGstin: partnerGstin, recipientGstin: builder?.gstin ?? null };
  const supplyMode = expectedSupplyMode({ ...parties, placeOfSupplyStateCode: values.placeOfSupply || null });
  const showIntra = supplyMode !== "INTER" || Boolean(values.cgst || values.sgst);
  const showInter = supplyMode !== "INTRA" || Boolean(values.igst);

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
        taxableValue: fields.taxableAmount,
        cgst: fields.cgstAmount,
        sgst: fields.sgstAmount,
        igst: fields.igstAmount,
        gstRate: fields.gstRateBps !== undefined ? formatBps(fields.gstRateBps, { suffix: false }) : undefined,
        placeOfSupply: fields.placeOfSupplyStateCode,
        irn: fields.irn,
        ackNumber: fields.ackNumber,
        ackDate: fields.ackDate,
        bookingTower: fields.bookingTower,
        bookingUnit: fields.bookingUnit,
        buyerInitials: fields.buyerInitials,
        agreementRegistrationNumber: fields.agreementRegistrationNumber,
        agreementDate: fields.agreementDate,
        agreementValue: fields.agreementValue,
        agreementBrokerageRate: fields.agreementBrokerageRate,
        tdsRate: fields.tdsRate,
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
    const problem = validate(values, selected, today, parties).file;
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
    const found = validate(values, file, today, parties);
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
  const rateBps = bpsOf(values.gstRate);
  const canCalculate = amountPaise !== null && amountPaise > 0n && rateBps !== null && supplyMode !== null;
  const agreed = agreedBrokeragePaise({
    agreementBrokeragePaise: paiseOf(values.agreementBrokerageAmount),
    agreementBrokerageBps: bpsOf(values.agreementBrokerageRate),
    agreementValuePaise: paiseOf(values.agreementValue),
  });
  const invoicedTaxable = amountPaise !== null ? invoicedTaxablePaise({ taxableValuePaise: paiseOf(values.taxableValue), totalPaise: amountPaise, gstAmountPaise: gstPaise }) : null;
  const brokerageGap = agreed !== null && invoicedTaxable !== null ? (agreed > invoicedTaxable ? agreed - invoicedTaxable : invoicedTaxable - agreed) : null;
  const posHint = values.placeOfSupply
    ? `${supplyMode === "INTRA" ? "Intra-state" : supplyMode === "INTER" ? "Inter-state" : "Supply type unknown"}`
    : builder?.gstin
      ? `Defaults to ${stateName(gstinStateCode(builder.gstin)) ?? "the builder's state"}`
      : "Defaults to the builder's registered state";

  function calculateSplit() {
    if (!canCalculate) return;
    const split = splitInclusiveTotal(amountPaise!, rateBps!, supplyMode!);
    const tax = split.cgstPaise + split.sgstPaise + split.igstPaise;
    const next: Partial<Values> = {
      taxableValue: paiseToDecimalString(split.taxablePaise),
      cgst: supplyMode === "INTRA" ? paiseToDecimalString(split.cgstPaise) : "",
      sgst: supplyMode === "INTRA" ? paiseToDecimalString(split.sgstPaise) : "",
      igst: supplyMode === "INTER" ? paiseToDecimalString(split.igstPaise) : "",
      gstAmount: paiseToDecimalString(tax),
    };
    for (const [key, value] of Object.entries(next) as [FieldName, string][]) setField(key, value);
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <FormSection step="1" title="Invoice document" description="Upload the signed tax invoice PDF. We read it in your browser to pre-fill the form.">
          {file ? (
            <div className={cn("flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:p-5", errors.file ? "border-destructive/50 bg-danger-soft/50" : "border-border bg-glass-100")}>
              <span className="relative flex h-14 w-11 shrink-0 flex-col items-center justify-end rounded-[4px] border border-line bg-card pb-1.5 shadow-[0_2px_0_var(--hairline)]">
                <span aria-hidden="true" className="absolute top-0 right-0 size-3 rounded-bl-[3px] border-b border-l border-line bg-glass-100" />
                <FileText className="mb-0.5 size-4 text-fg/60" strokeWidth={1.5} />
                <span className="text-[0.5rem] font-bold tracking-wider text-danger">PDF</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{file.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">PDF · {formatBytes(file.size)}</p>
                <ExtractionStatusLine extraction={extraction} />
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
                "group relative block cursor-pointer rounded-xl border p-1.5 transition-colors",
                dragging ? "border-line-strong bg-glass-50" : errors.file ? "border-destructive/40 bg-danger-soft/40" : "border-border bg-glass-50 hover:border-line-strong/60",
              )}
            >
              <span
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors sm:py-14",
                  dragging ? "border-line-strong" : "border-line group-hover:border-line-strong/70",
                )}
              >
                <span className="relative mb-5 flex size-20 items-center justify-center">
                  <ArchMotif className="absolute inset-0 size-20 text-fg-muted/60" />
                  <span className="relative mt-5 flex size-9 items-center justify-center rounded-full bg-night text-fg-muted shadow-button">
                    <UploadCloud className="size-4" strokeWidth={1.75} />
                  </span>
                </span>
                <span className="font-display text-[1.375rem] leading-tight font-normal text-fg">{dragging ? "Release to upload" : "Drop your invoice PDF here"}</span>
                <span className="mt-1.5 text-sm text-muted-foreground">
                  or <span className="font-medium text-fg underline decoration-fg-muted/60 underline-offset-4">browse your files</span>
                </span>
                <span className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
                  <span>PDF only</span>
                  <span aria-hidden="true" className="size-1 rotate-45 bg-haze" />
                  <span>Up to 10 MB</span>
                  <span aria-hidden="true" className="size-1 rotate-45 bg-haze" />
                  <span>Scans supported</span>
                </span>
              </span>
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
            <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
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
                placeholder="e.g. INV/2026/018"
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

        <FormSection step="4" title="Tax breakdown" description="The GST split as printed on the invoice. Intra-state supplies charge CGST and SGST; inter-state supplies charge IGST.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="taxableValue" label="Taxable value" error={errors.taxableValue} extracted={extracted.has("taxableValue")} hint="Brokerage before GST">
              <AmountInput id="field-taxableValue" value={values.taxableValue} onChange={(v) => setField("taxableValue", v)} invalid={Boolean(errors.taxableValue)} disabled={busy} />
            </Field>
            <Field id="gstRate" label="GST rate" error={errors.gstRate} extracted={extracted.has("gstRate")} hint="Brokerage services are taxed at 18%">
              <Select value={values.gstRate || undefined} onValueChange={(v) => setField("gstRate", v === AUTO ? "" : v)} disabled={busy}>
                <SelectTrigger id="field-gstRate" className="h-10 w-full bg-card" aria-invalid={Boolean(errors.gstRate)}>
                  <SelectValue placeholder="Not stated" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={AUTO}>Not stated</SelectItem>
                  {GST_RATES_BPS.map((bps) => (
                    <SelectItem key={bps} value={formatBps(bps, { suffix: false })}>
                      {formatBps(bps)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {showIntra && (
              <>
                <Field id="cgst" label="CGST" error={errors.cgst} extracted={extracted.has("cgst")}>
                  <AmountInput id="field-cgst" value={values.cgst} onChange={(v) => setField("cgst", v)} invalid={Boolean(errors.cgst)} disabled={busy} />
                </Field>
                <Field id="sgst" label="SGST" error={errors.sgst} extracted={extracted.has("sgst")}>
                  <AmountInput id="field-sgst" value={values.sgst} onChange={(v) => setField("sgst", v)} invalid={Boolean(errors.sgst)} disabled={busy} />
                </Field>
              </>
            )}
            {showInter && (
              <Field id="igst" label="IGST" error={errors.igst} extracted={extracted.has("igst")}>
                <AmountInput id="field-igst" value={values.igst} onChange={(v) => setField("igst", v)} invalid={Boolean(errors.igst)} disabled={busy} />
              </Field>
            )}
            <Field id="placeOfSupply" label="Place of supply" error={errors.placeOfSupply} extracted={extracted.has("placeOfSupply")} hint={posHint}>
              <Select value={values.placeOfSupply || undefined} onValueChange={(v) => setField("placeOfSupply", v === AUTO ? "" : v)} disabled={busy}>
                <SelectTrigger id="field-placeOfSupply" className="h-10 w-full bg-card" aria-invalid={Boolean(errors.placeOfSupply)}>
                  <SelectValue placeholder="Builder's state" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  <SelectItem value={AUTO}>Builder&apos;s state</SelectItem>
                  {STATE_OPTIONS.map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name} ({code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="tdsRate" label="TDS expected" error={errors.tdsRate} extracted={extracted.has("tdsRate")} hint="Percent deducted under section 194H, usually 2">
              <PercentInput id="field-tdsRate" value={values.tdsRate} onChange={(v) => setField("tdsRate", v)} invalid={Boolean(errors.tdsRate)} disabled={busy} placeholder="2" />
            </Field>
          </div>
          <div className="mt-5 flex flex-col gap-3 rounded-lg border border-hairline bg-glass-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {canCalculate
                ? `Fill the taxable value and ${supplyMode === "INTRA" ? "CGST + SGST" : "IGST"} from the invoice total at ${formatBps(rateBps!)}.`
                : "Enter the invoice total and GST rate to fill the split automatically."}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={calculateSplit} disabled={busy || !canCalculate} className="shrink-0">
              <Calculator />
              Calculate split
            </Button>
          </div>

          <div className="mt-7 border-t border-hairline pt-6">
            <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">E-invoice</p>
            <p className="mt-1 mb-5 text-[0.8125rem] text-muted-foreground">Only if the invoice was registered on the Invoice Registration Portal.</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="irn" label="IRN" error={errors.irn} extracted={extracted.has("irn")} className="sm:col-span-2" hint="64-character reference printed on the e-invoice">
                <Input
                  id="field-irn"
                  value={values.irn}
                  onChange={(e) => setField("irn", e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={80}
                  className="h-10 bg-card font-mono text-xs"
                  aria-invalid={Boolean(errors.irn)}
                  disabled={busy}
                />
              </Field>
              <Field id="ackNumber" label="Acknowledgement no." error={errors.ackNumber} extracted={extracted.has("ackNumber")}>
                <Input
                  id="field-ackNumber"
                  inputMode="numeric"
                  value={values.ackNumber}
                  onChange={(e) => setField("ackNumber", e.target.value)}
                  autoComplete="off"
                  maxLength={20}
                  className="figure h-10 bg-card"
                  aria-invalid={Boolean(errors.ackNumber)}
                  disabled={busy}
                />
              </Field>
              <Field id="ackDate" label="Acknowledgement date" error={errors.ackDate} extracted={extracted.has("ackDate")}>
                <Input
                  id="field-ackDate"
                  type="date"
                  value={values.ackDate}
                  min={values.invoiceDate || undefined}
                  max={today}
                  onChange={(e) => setField("ackDate", e.target.value)}
                  className="h-10 bg-card"
                  aria-invalid={Boolean(errors.ackDate)}
                  disabled={busy}
                />
              </Field>
            </div>
          </div>
        </FormSection>

        <FormSection step="5" title="Booking & agreement" description="Link the brokerage to the registered agreement for sale. Enter the buyer's initials only, never their name.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="bookingTower" label="Tower / wing" error={errors.bookingTower} extracted={extracted.has("bookingTower")}>
              <TextInput id="field-bookingTower" value={values.bookingTower} onChange={(v) => setField("bookingTower", v)} invalid={Boolean(errors.bookingTower)} disabled={busy} placeholder="e.g. B" maxLength={20} />
            </Field>
            <Field id="bookingUnit" label="Unit" error={errors.bookingUnit} extracted={extracted.has("bookingUnit")}>
              <TextInput id="field-bookingUnit" value={values.bookingUnit} onChange={(v) => setField("bookingUnit", v)} invalid={Boolean(errors.bookingUnit)} disabled={busy} placeholder="e.g. 1104" maxLength={20} />
            </Field>
            <Field id="buyerInitials" label="Buyer initials" error={errors.buyerInitials} extracted={extracted.has("buyerInitials")} hint="Initials only, for example RK">
              <TextInput
                id="field-buyerInitials"
                value={values.buyerInitials}
                onChange={(v) => setField("buyerInitials", v.toUpperCase())}
                invalid={Boolean(errors.buyerInitials)}
                disabled={busy}
                placeholder="RK"
                maxLength={8}
              />
            </Field>
            <Field id="agreementDate" label="Agreement date" error={errors.agreementDate} extracted={extracted.has("agreementDate")}>
              <Input
                id="field-agreementDate"
                type="date"
                value={values.agreementDate}
                max={values.invoiceDate || today}
                onChange={(e) => setField("agreementDate", e.target.value)}
                className="h-10 bg-card"
                aria-invalid={Boolean(errors.agreementDate)}
                disabled={busy}
              />
            </Field>
            <Field
              id="agreementRegistrationNumber"
              label="Agreement registration no."
              error={errors.agreementRegistrationNumber}
              extracted={extracted.has("agreementRegistrationNumber")}
              className="sm:col-span-2"
              hint="As registered with the sub-registrar"
            >
              <TextInput
                id="field-agreementRegistrationNumber"
                value={values.agreementRegistrationNumber}
                onChange={(v) => setField("agreementRegistrationNumber", v)}
                invalid={Boolean(errors.agreementRegistrationNumber)}
                disabled={busy}
                placeholder="e.g. HVL-2/4821/2026"
                maxLength={40}
              />
            </Field>
            <Field id="agreementValue" label="Agreement value" error={errors.agreementValue} extracted={extracted.has("agreementValue")} className="sm:col-span-2">
              <AmountInput id="field-agreementValue" value={values.agreementValue} onChange={(v) => setField("agreementValue", v)} invalid={Boolean(errors.agreementValue)} disabled={busy} />
            </Field>
            <Field id="agreementBrokerageRate" label="Brokerage in agreement (%)" error={errors.agreementBrokerageRate} extracted={extracted.has("agreementBrokerageRate")}>
              <PercentInput
                id="field-agreementBrokerageRate"
                value={values.agreementBrokerageRate}
                onChange={(v) => setField("agreementBrokerageRate", v)}
                invalid={Boolean(errors.agreementBrokerageRate)}
                disabled={busy}
                placeholder="2"
              />
            </Field>
            <Field id="agreementBrokerageAmount" label="or brokerage amount" error={errors.agreementBrokerageAmount} extracted={extracted.has("agreementBrokerageAmount")}>
              <AmountInput
                id="field-agreementBrokerageAmount"
                value={values.agreementBrokerageAmount}
                onChange={(v) => setField("agreementBrokerageAmount", v)}
                invalid={Boolean(errors.agreementBrokerageAmount)}
                disabled={busy}
              />
            </Field>
          </div>
          {agreed !== null && invoicedTaxable !== null && brokerageGap !== null && (
            <p
              className={cn(
                "mt-5 flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-xs leading-relaxed",
                brokerageGap <= brokerageTolerancePaise(agreed) ? "bg-leaf-50 text-leaf" : "bg-warning-soft text-warning",
              )}
            >
              {brokerageGap <= brokerageTolerancePaise(agreed) ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0" />}
              Agreement brokerage {formatINR(agreed)} · invoiced taxable value {formatINR(invoicedTaxable)}
              {brokerageGap <= brokerageTolerancePaise(agreed) ? " · consistent" : " · differs by more than 1%"}
            </p>
          )}
        </FormSection>

        {formError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        )}

        <div className="surface flex flex-col-reverse gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">By submitting you confirm this invoice is genuine and raised under your empanelment agreement.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" size="lg" onClick={() => router.push("/partner/invoices")} disabled={busy}>
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
        <SubmissionSummary builder={builder} projectId={values.projectId} invoiceNumber={values.invoiceNumber} amountPaise={amountPaise} gstPaise={gstPaise} />
        <div className="surface p-5">
          <p className="mb-4 text-[0.625rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase">What happens next</p>
          <ol className="grid gap-4 text-sm">
            {[
              ["Builder review", "The builder's accounts team approves, rejects or asks for clarification."],
              ["Early payment", "Once approved, get the discounted amount at your builder's agreed rate."],
              ["Payout", "Veefin approves and pays the net amount to your bank account."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3.5">
                <span className="font-display text-lg leading-none font-normal text-fg-muted tabular">{`0${i + 1}`}</span>
                <span>
                  <span className="block font-medium text-fg">{title}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
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
      <header className="flex items-start gap-4 px-5 pt-6 pb-5 sm:px-7">
        <span className="font-display text-[1.75rem] leading-none font-normal text-fg-muted tabular">{step.padStart(2, "0")}</span>
        <div className="border-l border-hairline pl-4">
          <h2 className="font-display text-[1.25rem] leading-tight font-normal">{title}</h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="border-t border-hairline px-5 py-6 sm:px-7">{children}</div>
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
          <span className="inline-flex items-center gap-1 rounded-full border border-line-strong/40 bg-glass-50 px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.04em] text-fg-muted">
            <ScanText className="size-3" />
            Extracted — please verify
          </span>
        )}
      </div>
      <div className={cn("rounded-md transition-shadow", extracted && "shadow-[0_0_0_1px_var(--color-signal-500),0_0_0_4px_rgb(168_154_132/0.16)] [&_button]:bg-glass-50/60 [&_input]:bg-glass-50/60")}>{children}</div>
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
        className="figure h-10 bg-card pl-7"
        aria-invalid={invalid}
        disabled={disabled}
      />
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
  maxLength,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  disabled: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete="off"
      className="h-10 bg-card"
      aria-invalid={invalid}
      disabled={disabled}
    />
  );
}

function PercentInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  disabled: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="figure h-10 bg-card pr-8"
        aria-invalid={invalid}
        disabled={disabled}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

function ExtractionPanel({ extraction, builder, partnerGstin }: { extraction: Extraction; builder: UploadBuilder | null; partnerGstin: string | null }) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">In-browser reading</p>
          <p className="mt-1 flex items-center gap-2 font-display text-[1.25rem] font-normal text-fg">
            <ScanText className="size-4 text-fg-muted" />
            Smart extraction
          </p>
        </div>
        {extraction.status === "done" && (
          <span className="rounded-full border border-leaf/20 bg-leaf-50 px-2.5 py-0.5 text-[0.625rem] font-semibold text-leaf">
            {extraction.method === "ocr" ? "OCR · scanned" : "Text layer"}
          </span>
        )}
      </div>
      <div className="border-t border-hairline px-5 py-5 text-sm" aria-live="polite">
        {extraction.status === "idle" && (
          <p className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            Choose a PDF and we&apos;ll read the invoice number, dates, parties, GSTINs and amounts for you to verify.
          </p>
        )}
        {extraction.status === "running" && (
          <div className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
                <Loader2 className="size-4 animate-spin text-fg-muted" />
                {extraction.message}
              </p>
              <span className="figure text-[1.5rem] leading-none font-light text-fg">
                {Math.round(extraction.progress * 100)}
                <span className="text-[0.6em] opacity-50">%</span>
              </span>
            </div>
            <Progress
              value={Math.round(extraction.progress * 100)}
              className="h-1 bg-glass-200 [&>[data-slot=progress-indicator]]:bg-linear-to-r [&>[data-slot=progress-indicator]]:from-haze [&>[data-slot=progress-indicator]]:to-haze"
              aria-label="Extraction progress"
            />
            <p className="text-xs text-muted-foreground">You can keep filling in the form while this runs.</p>
          </div>
        )}
        {extraction.status === "failed" && (
          <p className="flex items-start gap-2 text-[0.8125rem] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {extraction.message}
          </p>
        )}
        {extraction.status === "done" && <ExtractionSummary extraction={extraction} builder={builder} partnerGstin={partnerGstin} />}
      </div>
      <p className="flex items-start gap-2 border-t border-hairline bg-glass-100 px-5 py-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3 shrink-0" />
        Processed locally in your browser. The document is not sent to any external service for extraction.
      </p>
    </div>
  );
}

function ExtractionStatusLine({ extraction }: { extraction: Extraction }) {
  if (extraction.status === "running") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Reading · {Math.round(extraction.progress * 100)}%
      </p>
    );
  }
  if (extraction.status === "done") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-leaf">
        <CheckCircle2 className="size-3.5" />
        {extraction.filled.length ? `Extracted ${extraction.filled.length} ${extraction.filled.length === 1 ? "field" : "fields"} — please verify` : "Read — enter details manually"}
      </p>
    );
  }
  if (extraction.status === "failed") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
        <AlertTriangle className="size-3.5" />
        Could not read automatically
      </p>
    );
  }
  return null;
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
    ["Booking", [fields.bookingTower, fields.bookingUnit].filter(Boolean).join(" · ") || undefined],
    ["Agreement no.", fields.agreementRegistrationNumber],
    ["Agreement value", fields.agreementValue && money(fields.agreementValue), true],
    ["IRN", fields.irn && `${fields.irn.slice(0, 10)}…${fields.irn.slice(-6)}`],
  ];
  const shown = rows.filter(([, value]) => value);
  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2 text-leaf">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        {extraction.filled.length
          ? `${extraction.filled.length} ${extraction.filled.length === 1 ? "field" : "fields"} pre-filled. Review each highlighted field before submitting.`
          : "No form fields could be pre-filled. Please enter the details manually."}
      </p>
      {shown.length > 0 && (
        <dl className="grid gap-2.5 rounded-lg border border-hairline bg-glass-100 p-4 text-xs">
          {shown.map(([label, value, numeric]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className={cn("min-w-0 text-right font-medium break-words text-fg", numeric && "figure")}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="grid gap-1.5 text-xs">
        {extraction.builderMatch && (
          <li className="flex items-start gap-1.5 text-leaf">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" />
            Builder matched by {extraction.builderMatch === "gstin" ? "GSTIN" : "name"}.
          </li>
        )}
        {!extraction.builderMatch && (fields.builderName || fields.builderGstin) && (
          <li className="flex items-start gap-1.5 text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            The billed builder doesn&apos;t match any builder you are empanelled with. Select it manually.
          </li>
        )}
        {fields.amountsReconcile === true && (
          <li className="flex items-start gap-1.5 text-leaf">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" />
            Taxable value and GST add up to the invoice total.
          </li>
        )}
        {fields.amountsReconcile === false && (
          <li className="flex items-start gap-1.5 text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Taxable value and GST do not add up to the total. Check the amounts.
          </li>
        )}
        {supplierMismatch && (
          <li className="flex items-start gap-1.5 text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Supplier GSTIN differs from your registered GSTIN ({partnerGstin}).
          </li>
        )}
        {builderGstinMismatch && (
          <li className="flex items-start gap-1.5 text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            Builder GSTIN on the invoice differs from {builder?.name}&apos;s registered GSTIN.
          </li>
        )}
      </ul>
    </div>
  );
}

function SubmissionSummary({
  builder,
  projectId,
  invoiceNumber,
  amountPaise,
  gstPaise,
}: {
  builder: UploadBuilder | null;
  projectId: string;
  invoiceNumber: string;
  amountPaise: bigint | null;
  gstPaise: bigint | null;
}) {
  const project = builder?.projects.find((p) => p.id === projectId);
  const total = amountPaise !== null && amountPaise > 0n ? amountPaise : null;
  return (
    <div className="surface overflow-hidden">
      <div aria-hidden="true" className="h-[3px] bg-linear-to-r from-night via-night to-haze" />
      <div className="px-5 py-5">
        <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase">Submission summary</p>
        <p className="mt-3 text-xs text-muted-foreground">Invoice total</p>
        {total !== null ? <Money paise={total} size="xl" className="mt-1 block font-medium text-fg" /> : <p className="figure mt-1 text-[1.875rem] leading-none text-fg">₹ —</p>}
        <dl className="mt-5 grid gap-2.5 border-t border-hairline pt-4 text-[0.8125rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Invoice no.</dt>
            <dd className="truncate text-right font-medium text-fg">{invoiceNumber.trim() || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Builder</dt>
            <dd className="truncate text-right font-medium text-fg">{builder?.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Project</dt>
            <dd className="truncate text-right font-medium text-fg">{project?.name ?? "—"}</dd>
          </div>
          {total !== null && gstPaise !== null && gstPaise < total && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Taxable value</dt>
              <dd className="text-right font-medium text-fg">
                <Money paise={total - gstPaise} />
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
