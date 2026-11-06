"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { validateAccountNumber, validateGstin, validateIfsc, validatePan, validateReraAgentNumber, validateUdyam } from "@/lib/verification/validation";
import type { ActionResult } from "@/server/action-result";
import { submitBankAccountAction, submitGstinAction, submitPanAction, submitReraAction, submitUdyamAction } from "@/server/actions/kyc";

export type VerifyKind = "GSTIN" | "PAN" | "UDYAM" | "BANK_ACCOUNT" | "RERA_AGENT";

type Errors = Record<string, string | undefined>;

const COPY: Record<VerifyKind, { title: string; description: string; confirm: string }> = {
  GSTIN: { title: "Verify GST registration", description: "We confirm the GSTIN, its status and the registered name with the GST network.", confirm: "Verify GSTIN" },
  PAN: { title: "Verify PAN", description: "We confirm the PAN with the Income Tax Department and match the name to your organisation.", confirm: "Verify PAN" },
  UDYAM: { title: "Verify Udyam registration", description: "Optional. Confirms your MSME category for priority programmes.", confirm: "Verify Udyam" },
  BANK_ACCOUNT: {
    title: "Add a payout bank account",
    description: "We deposit ₹1 to confirm the account and the name it is held in. Early payments are only paid to a verified account.",
    confirm: "Verify account",
  },
  RERA_AGENT: {
    title: "RERA agent registration",
    description: "Record your MahaRERA agent registration. Our team checks it against the public register, usually within one working day.",
    confirm: "Submit for review",
  },
};

function FieldRow({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p id={`${id}-help`} role={error ? "alert" : undefined} className={cn("text-xs leading-relaxed", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? hint}
      </p>
    </div>
  );
}

function firstErrors(fieldErrors: Record<string, string[]> | undefined): Errors {
  return Object.fromEntries(Object.entries(fieldErrors ?? {}).map(([key, list]) => [key, list[0]]));
}

export function VerifyDialog({
  kind,
  trigger,
  triggerVariant = "outline",
  allowNotRegistered = false,
  hasPrimaryAccount = false,
  coolingOffHours = 72,
  defaultHolderName = "",
}: {
  kind: VerifyKind;
  trigger: string;
  triggerVariant?: "default" | "outline" | "accent" | "secondary";
  allowNotRegistered?: boolean;
  hasPrimaryAccount?: boolean;
  coolingOffHours?: number;
  defaultHolderName?: string;
}) {
  const id = useId();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notRegistered, setNotRegistered] = useState(false);
  const [makePrimary, setMakePrimary] = useState(false);
  const [pending, startTransition] = useTransition();
  const copy = COPY[kind];
  const fid = (name: string) => `${id}-${name}`;

  function value(name: string): string {
    const element = form.current?.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element.value : "";
  }

  function localErrors(): Errors {
    const out: Errors = {};
    const check = (name: string, result: { ok: boolean; error?: string }) => {
      if (!result.ok) out[name] = result.error;
    };
    if (kind === "GSTIN" && !notRegistered) check("gstin", validateGstin(value("gstin")));
    if (kind === "PAN") check("pan", validatePan(value("pan")));
    if (kind === "UDYAM") check("udyamNumber", validateUdyam(value("udyamNumber")));
    if (kind === "BANK_ACCOUNT") {
      check("accountNumber", validateAccountNumber(value("accountNumber")));
      check("ifsc", validateIfsc(value("ifsc")));
      if (value("accountNumber").replace(/\s/g, "") !== value("confirmAccountNumber").replace(/\s/g, "")) out.confirmAccountNumber = "The account numbers do not match";
    }
    if (kind === "RERA_AGENT") {
      check("registrationNumber", validateReraAgentNumber(value("registrationNumber")));
      if (!value("validUntil")) out.validUntil = "Enter the expiry date on the certificate";
    }
    return out;
  }

  async function send(): Promise<ActionResult<{ status: string | null; reasons: string[] }>> {
    switch (kind) {
      case "GSTIN":
        return submitGstinAction(notRegistered ? { notRegistered: true } : { gstin: value("gstin") });
      case "PAN":
        return submitPanAction({ pan: value("pan") });
      case "UDYAM":
        return submitUdyamAction({ udyamNumber: value("udyamNumber") });
      case "BANK_ACCOUNT":
        return submitBankAccountAction({
          accountNumber: value("accountNumber"),
          confirmAccountNumber: value("confirmAccountNumber"),
          ifsc: value("ifsc"),
          accountHolderName: value("accountHolderName") || undefined,
          makePrimary: hasPrimaryAccount ? makePrimary : undefined,
        });
      case "RERA_AGENT":
        return submitReraAction(new FormData(form.current!));
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = localErrors();
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    startTransition(async () => {
      const result = await send();
      if (!result.ok) {
        setErrors(firstErrors(result.fieldErrors));
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      const status = result.data.status;
      if (status === "FAILED") {
        setFormError(result.data.reasons[0] ?? "We could not verify these details.");
        toast.error(result.message ?? "We could not verify these details.");
        router.refresh();
        return;
      }
      if (status === "REVIEW_REQUIRED") toast.warning(result.message ?? "Submitted for review.", { description: result.data.reasons[0] });
      else toast.success(result.message ?? "Saved.");
      setOpen(false);
      router.refresh();
    });
  }

  const input = (name: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Input
      id={fid(name)}
      name={name}
      disabled={pending}
      aria-invalid={Boolean(errors[name])}
      aria-describedby={`${fid(name)}-help`}
      autoComplete="off"
      spellCheck={false}
      className="h-10 bg-card"
      {...props}
    />
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setErrors({});
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="gap-0">
          <span aria-hidden="true" className="mb-4 flex size-11 items-center justify-center rounded-full bg-glass-50 text-fg ring-1 ring-line ring-inset">
            <ShieldCheck className="size-5" strokeWidth={1.6} />
          </span>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="mt-2">{copy.description}</DialogDescription>
        </DialogHeader>

        <form ref={form} id={`${id}-form`} onSubmit={submit} noValidate className="grid gap-4">
          {kind === "GSTIN" && (
            <>
              {!notRegistered && (
                <FieldRow id={fid("gstin")} label="GSTIN" hint="15 characters, e.g. 27ABCDE1234F1Z5" error={errors.gstin}>
                  {input("gstin", { placeholder: "27ABCDE1234F1Z5", maxLength: 15, className: "h-10 bg-card font-mono tracking-wider uppercase" })}
                </FieldRow>
              )}
              {allowNotRegistered && (
                <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-[0.8125rem] leading-relaxed text-fg-soft">
                  <Checkbox checked={notRegistered} onCheckedChange={(checked) => setNotRegistered(checked === true)} disabled={pending} className="mt-0.5" />
                  <span>
                    We are not registered under GST
                    <span className="block text-xs text-muted-foreground">Allowed only when turnover is below the GST registration threshold.</span>
                  </span>
                </label>
              )}
            </>
          )}

          {kind === "PAN" && (
            <FieldRow id={fid("pan")} label="Organisation PAN" hint="The PAN of the organisation, not of an individual partner." error={errors.pan}>
              {input("pan", { placeholder: "ABCDE1234F", maxLength: 10, className: "h-10 bg-card font-mono tracking-wider uppercase" })}
            </FieldRow>
          )}

          {kind === "UDYAM" && (
            <FieldRow id={fid("udyamNumber")} label="Udyam registration number" hint="As printed on the Udyam certificate." error={errors.udyamNumber}>
              {input("udyamNumber", { placeholder: "UDYAM-MH-12-1234567", maxLength: 19, className: "h-10 bg-card font-mono tracking-wide uppercase" })}
            </FieldRow>
          )}

          {kind === "BANK_ACCOUNT" && (
            <>
              <FieldRow id={fid("accountNumber")} label="Account number" error={errors.accountNumber}>
                {input("accountNumber", { inputMode: "numeric", type: "password", maxLength: 22, className: "h-10 bg-card font-mono tracking-wider" })}
              </FieldRow>
              <FieldRow id={fid("confirmAccountNumber")} label="Confirm account number" error={errors.confirmAccountNumber}>
                {input("confirmAccountNumber", { inputMode: "numeric", maxLength: 22, className: "h-10 bg-card font-mono tracking-wider", onPaste: (e) => e.preventDefault() })}
              </FieldRow>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow id={fid("ifsc")} label="IFSC" hint="Fifth character is zero" error={errors.ifsc}>
                  {input("ifsc", { placeholder: "HDFC0001234", maxLength: 11, className: "h-10 bg-card font-mono tracking-wider uppercase" })}
                </FieldRow>
                <FieldRow id={fid("accountHolderName")} label="Account holder" hint="Must match your legal name" error={errors.accountHolderName}>
                  {input("accountHolderName", { defaultValue: defaultHolderName, maxLength: 120 })}
                </FieldRow>
              </div>
              {hasPrimaryAccount && (
                <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-[0.8125rem] leading-relaxed text-fg-soft">
                  <Checkbox checked={makePrimary} onCheckedChange={(checked) => setMakePrimary(checked === true)} disabled={pending} className="mt-0.5" />
                  <span>
                    Use this account for payouts once verified
                    <span className="block text-xs text-muted-foreground">For your security, early payments pause for {coolingOffHours} hours after the payout account changes.</span>
                  </span>
                </label>
              )}
            </>
          )}

          {kind === "RERA_AGENT" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow id={fid("registrationNumber")} label="Registration number" hint="MahaRERA agent number, e.g. A51800012345" error={errors.registrationNumber}>
                  {input("registrationNumber", { placeholder: "A51800012345", maxLength: 40, className: "h-10 bg-card font-mono tracking-wider uppercase" })}
                </FieldRow>
                <FieldRow id={fid("validUntil")} label="Valid until" hint="Expiry date on the certificate" error={errors.validUntil}>
                  {input("validUntil", { type: "date" })}
                </FieldRow>
              </div>
              <FieldRow id={fid("certificate")} label="Registration certificate" hint="PDF, PNG or JPEG, up to 5 MB. Speeds up the review." error={errors.certificate}>
                {input("certificate", { type: "file", accept: "application/pdf,image/png,image/jpeg", className: "h-10 bg-card pt-1.5" })}
              </FieldRow>
            </>
          )}

          {formError && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/15 bg-danger-soft px-3 py-2 text-sm text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              {formError}
            </p>
          )}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form={`${id}-form`} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {kind === "GSTIN" && notRegistered ? "Save declaration" : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
