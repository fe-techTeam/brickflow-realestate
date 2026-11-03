"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pencil, Plus, ShieldCheck, Stamp } from "lucide-react";
import { toast } from "sonner";
import type { ProgrammeStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parsePercentToBps } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createProgrammeAction, updateProgrammeAction } from "@/server/actions/admin";
import { RatePreview } from "./rate-preview";
import { PROGRAMME_STATUS_OPTIONS, type OrgOption, type ProgrammeFormValues, type ProgrammeRow } from "./types";

type FieldErrors = Record<string, string[] | undefined>;

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {errors[0]}
    </p>
  );
}

function Field({
  id,
  label,
  required,
  hint,
  errors,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  errors?: string[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-[0.6875rem] font-semibold tracking-[0.12em] text-ink/80 uppercase">
        {label}
        {required && <span className="text-kota-600"> *</span>}
      </Label>
      {children}
      {errors?.length ? <FieldError id={`${id}-error`} errors={errors} /> : hint ? <p className="text-xs leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function emptyValues(): ProgrammeFormValues {
  return { name: "", discountRate: "", status: "DRAFT", effectiveFrom: todayIso(), effectiveTo: "", offerValidityDays: "7", terms: "" };
}

function differs(a: ProgrammeFormValues, b: ProgrammeFormValues, rateBps: number | null, originalBps: number): boolean {
  return (
    (rateBps !== null && rateBps !== originalBps) ||
    a.status !== b.status ||
    a.effectiveFrom !== b.effectiveFrom ||
    a.effectiveTo !== b.effectiveTo ||
    a.terms.trim() !== b.terms.trim()
  );
}

type Props =
  | {
      mode: "create";
      builders: OrgOption[];
      financiers: OrgOption[];
      activeByBuilder: Record<string, string>;
      presetBuilderId?: string;
      trigger?: "primary" | "subtle";
      programme?: undefined;
    }
  | { mode: "edit"; programme: ProgrammeRow; builders?: undefined; financiers?: undefined; activeByBuilder?: undefined; presetBuilderId?: undefined; trigger?: undefined };

const inputClass = "h-10 bg-card";

/** Create or edit a financing programme. The discount rate entered here is the only source of pricing on the platform. */
export function ProgrammeFormDialog(props: Props) {
  const router = useRouter();
  const uid = useId();
  const editing = props.mode === "edit";
  const initial = editing ? props.programme.values : emptyValues();
  const presetBuilder = props.presetBuilderId ?? "";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ProgrammeFormValues>(initial);
  const [builderId, setBuilderId] = useState(presetBuilder);
  const [financierId, setFinancierId] = useState(props.mode === "create" && props.financiers.length === 1 ? props.financiers[0]!.id : "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const id = (name: string) => `${uid}-${name}`;
  const set = <K extends keyof ProgrammeFormValues>(key: K, value: ProgrammeFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const describedBy = (name: string) => (errors[name]?.length ? `${id(name)}-error` : undefined);

  const rateBps = parsePercentToBps(values.discountRate);
  const termsChanged = editing && differs(values, initial, rateBps, props.programme.discountRateBps);
  const activeConflict = !editing && builderId && values.status === "ACTIVE" ? props.activeByBuilder[builderId] : undefined;

  function reset() {
    setValues(initial);
    setBuilderId(presetBuilder);
    setErrors({});
    setFormError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setErrors({});
    startTransition(async () => {
      if (props.mode === "edit") {
        const result = await updateProgrammeAction(props.programme.id, { ...values, effectiveTo: values.effectiveTo || undefined });
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
          toast.error(result.error);
          return;
        }
        const withdrawn = result.data.openOffersWithdrawn;
        toast.success(result.message ?? "Programme updated.", {
          description:
            withdrawn > 0
              ? `${withdrawn} open offer${withdrawn === 1 ? " was" : "s were"} withdrawn. Channel partners will see the new terms when they regenerate.`
              : "No open offers were affected.",
        });
      } else {
        const result = await createProgrammeAction({ ...values, builderId, financierId, effectiveTo: values.effectiveTo || undefined });
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success(result.message ?? "Financing programme created.", { description: `Programme ${result.data.code} is now listed.` });
        setValues(emptyValues());
        setBuilderId(presetBuilder);
      }
      setOpen(false);
      router.refresh();
    });
  }

  const fieldErrorCount = Object.values(errors).filter((e) => e?.length).length;
  const presetName = props.mode === "create" && presetBuilder ? props.builders.find((b) => b.id === presetBuilder)?.name : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="outline" size="sm" aria-label={`Edit ${props.programme.code}`} className="bg-card">
            <Pencil className="size-3.5" />
            Edit
          </Button>
        ) : props.trigger === "subtle" ? (
          <Button variant="outline" size="sm" className="bg-card" aria-label={presetName ? `Configure a programme for ${presetName}` : undefined}>
            <Plus className="size-3.5" />
            Configure programme
          </Button>
        ) : (
          <Button size="lg" className="shadow-[0_10px_24px_-12px_rgba(34, 45, 43,0.6)]">
            <Plus className="size-4 text-kota" />
            Create programme
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[94vh] gap-0 overflow-y-auto p-0 sm:max-w-[62rem]">
        <form onSubmit={submit} noValidate className="grid md:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="px-5 pt-7 pb-6 sm:px-8">
            <DialogHeader className="gap-0 text-left">
              <p className="flex items-center gap-2.5 text-[0.625rem] font-semibold tracking-[0.22em] text-kota-600 uppercase">
                <span aria-hidden="true" className="h-px w-5 bg-kota" />
                {editing ? "Amend financing mandate" : "New financing mandate"}
              </p>
              <DialogTitle className="mt-2.5 font-display text-[1.875rem] leading-tight font-semibold text-basalt">
                {editing ? `Edit ${props.programme.code}` : "Create financing programme"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
                {editing
                  ? `${props.programme.builderName} · funded by ${props.programme.financierName}. Enter the discount exactly as agreed between the builder and the financier.`
                  : "Record the terms agreed off-platform between a builder and the financier. Channel partners and builders see this rate but cannot change it."}
              </DialogDescription>
            </DialogHeader>

            {formError && fieldErrorCount === 0 && (
              <div role="alert" className="mt-5 flex gap-3 rounded-lg border-l-2 border-warning/70 bg-warning-soft px-4 py-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">The programme could not be saved</p>
                  <p className="mt-0.5">{formError}</p>
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-x-5 gap-y-5 sm:grid-cols-2">
              <Field id={id("name")} label="Programme name" required errors={errors.name} className="sm:col-span-2">
                <Input
                  id={id("name")}
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Builder name — Channel Partner Early Payment"
                  aria-invalid={Boolean(errors.name?.length)}
                  aria-describedby={describedBy("name")}
                  className={inputClass}
                  maxLength={120}
                />
              </Field>

              {props.mode === "create" && (
                <>
                  <Field
                    id={id("builderId")}
                    label="Builder"
                    required
                    errors={errors.builderId}
                    hint={builderId && props.activeByBuilder[builderId] ? `Active programme today: ${props.activeByBuilder[builderId]}` : undefined}
                  >
                    <Select
                      value={builderId}
                      onValueChange={(v) => {
                        setBuilderId(v);
                        setErrors((e) => ({ ...e, builderId: undefined }));
                      }}
                    >
                      <SelectTrigger
                        id={id("builderId")}
                        className="h-10 w-full bg-card data-[size=default]:h-10"
                        aria-invalid={Boolean(errors.builderId?.length)}
                        aria-describedby={describedBy("builderId")}
                      >
                        <SelectValue placeholder="Select a builder" />
                      </SelectTrigger>
                      <SelectContent>
                        {props.builders.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                            {b.status === "INACTIVE" ? " (inactive)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id={id("financierId")} label="Financier" required errors={errors.financierId}>
                    <Select
                      value={financierId}
                      onValueChange={(v) => {
                        setFinancierId(v);
                        setErrors((e) => ({ ...e, financierId: undefined }));
                      }}
                    >
                      <SelectTrigger
                        id={id("financierId")}
                        className="h-10 w-full bg-card data-[size=default]:h-10"
                        aria-invalid={Boolean(errors.financierId?.length)}
                        aria-describedby={describedBy("financierId")}
                      >
                        <SelectValue placeholder="Select a financier" />
                      </SelectTrigger>
                      <SelectContent>
                        {props.financiers.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name}
                            {f.status === "INACTIVE" ? " (inactive)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              )}

              <Field
                id={id("discountRate")}
                label="Agreed discount (%)"
                required
                errors={errors.discountRate}
                hint="Fixed percentage of the builder-approved amount, up to 2 decimals."
              >
                <div className="relative">
                  <Input
                    id={id("discountRate")}
                    value={values.discountRate}
                    onChange={(e) => set("discountRate", e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="2.5"
                    aria-invalid={Boolean(errors.discountRate?.length)}
                    aria-describedby={describedBy("discountRate")}
                    className="tabular h-12 border-kota/50 bg-card pr-10 font-sans text-[1.5rem] font-light tracking-[-0.02em] text-basalt focus-visible:border-kota"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-lg font-light text-kota-600">%</span>
                </div>
              </Field>

              <Field
                id={id("status")}
                label="Status"
                required
                errors={errors.status}
                hint={PROGRAMME_STATUS_OPTIONS.find((o) => o.value === values.status)?.hint}
              >
                <Select value={values.status} onValueChange={(v) => set("status", v as ProgrammeStatus)}>
                  <SelectTrigger id={id("status")} className="h-12 w-full bg-card data-[size=default]:h-12" aria-invalid={Boolean(errors.status?.length)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROGRAMME_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {activeConflict && (
                <p role="status" className="flex gap-2.5 rounded-lg border-l-2 border-warning/70 bg-warning-soft px-3.5 py-2.5 text-xs leading-relaxed text-warning sm:col-span-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  This builder already has an active programme ({activeConflict}). Save as draft, or suspend or close {activeConflict} first.
                </p>
              )}

              <div className="grid gap-x-5 gap-y-5 sm:col-span-2 sm:grid-cols-3">
                <Field id={id("effectiveFrom")} label="Effective from" required errors={errors.effectiveFrom}>
                  <Input
                    id={id("effectiveFrom")}
                    type="date"
                    value={values.effectiveFrom}
                    onChange={(e) => set("effectiveFrom", e.target.value)}
                    aria-invalid={Boolean(errors.effectiveFrom?.length)}
                    aria-describedby={describedBy("effectiveFrom")}
                    className={cn(inputClass, "tabular")}
                  />
                </Field>
                <Field id={id("effectiveTo")} label="Effective to" errors={errors.effectiveTo} hint="Blank for open-ended.">
                  <Input
                    id={id("effectiveTo")}
                    type="date"
                    value={values.effectiveTo}
                    min={values.effectiveFrom || undefined}
                    onChange={(e) => set("effectiveTo", e.target.value)}
                    aria-invalid={Boolean(errors.effectiveTo?.length)}
                    aria-describedby={describedBy("effectiveTo")}
                    className={cn(inputClass, "tabular")}
                  />
                </Field>

                <Field
                  id={id("offerValidityDays")}
                  label="Validity (days)"
                  required
                  errors={errors.offerValidityDays}
                  hint="Offer lifetime, 1–90."
                >
                  <Input
                    id={id("offerValidityDays")}
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    value={values.offerValidityDays}
                    onChange={(e) => set("offerValidityDays", e.target.value)}
                    aria-invalid={Boolean(errors.offerValidityDays?.length)}
                    aria-describedby={describedBy("offerValidityDays")}
                    className={cn(inputClass, "tabular")}
                  />
                </Field>
              </div>

              <Field
                id={id("terms")}
                label="Programme terms"
                required
                errors={errors.terms}
                hint="Shown to channel partners with every offer."
                className="sm:col-span-2"
              >
                <Textarea
                  id={id("terms")}
                  value={values.terms}
                  onChange={(e) => set("terms", e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="Fixed discount on the builder-approved invoice amount, agreed between the financier and the builder. No other charges. The builder settles the full approved amount with the financier on the original due date."
                  aria-invalid={Boolean(errors.terms?.length)}
                  aria-describedby={describedBy("terms")}
                  className="bg-card leading-relaxed"
                />
              </Field>
            </div>
          </div>

          <aside className="flex flex-col gap-5 border-t border-border/80 bg-paper/80 px-5 pt-7 pb-6 sm:px-7 md:border-t-0 md:border-l">
            <RatePreview rate={values.discountRate} currentBps={editing ? props.programme.discountRateBps : undefined} />

            <div className="flex gap-3 rounded-lg border-l-2 border-leaf bg-leaf-100/50 px-3.5 py-3 text-xs leading-relaxed text-leaf">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <div>
                <p className="font-semibold">Snapshot protected</p>
                <p className="mt-0.5 text-leaf/90">
                  {editing
                    ? `Accepted financing requests (${props.programme.requests}) keep the rate and amounts agreed at acceptance and are never repriced.`
                    : "Once a channel partner accepts an offer, its rate and amounts are frozen. Later changes never reprice it."}
                </p>
              </div>
            </div>

            {editing && (
              <div
                className={cn(
                  "flex gap-3 rounded-lg border-l-2 px-3.5 py-3 text-xs leading-relaxed transition-colors",
                  termsChanged ? "border-warning/70 bg-warning-soft text-warning" : "border-border bg-card text-ink",
                )}
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <p className="font-semibold">{termsChanged ? "Open offers will be withdrawn" : "How changes apply"}</p>
                  <p className="mt-0.5">
                    {props.programme.openOffers > 0
                      ? `${props.programme.openOffers} open (unaccepted) offer${props.programme.openOffers === 1 ? "" : "s"} priced on this programme will be withdrawn if you change the rate, status, dates or terms. Channel partners regenerate to see the new terms.`
                      : "Open (unaccepted) offers on this programme are withdrawn when the rate, status, dates or terms change. There are none at the moment."}
                  </p>
                </div>
              </div>
            )}

            {!editing && (
              <div className="flex gap-3 rounded-lg border-l-2 border-kota bg-card px-3.5 py-3 text-xs leading-relaxed text-ink">
                <Stamp className="mt-0.5 size-4 shrink-0 text-kota-600" strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <p className="font-semibold text-basalt">One active programme per builder</p>
                  <p className="mt-0.5">Save as draft to prepare new terms while the current programme stays live.</p>
                </div>
              </div>
            )}
          </aside>

          <div className="flex flex-col-reverse gap-2 border-t border-border/80 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 md:col-span-2">
            <p className="hidden text-xs text-muted-foreground sm:block">Every change is recorded in the audit log under your name.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending} className="min-w-40">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Stamp className="size-4 text-kota" />}
                {editing ? "Save changes" : "Create programme"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
