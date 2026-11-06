"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CircleAlert, Landmark, Loader2, HandCoins, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action-result";
import type { StepUpPurpose } from "@/server/auth/step-up";
import { useStepUp } from "@/components/security/step-up-dialog";

type ButtonVariant = "default" | "accent" | "success" | "outline" | "secondary" | "ghost" | "destructive" | "link";

const MEDALLION: Partial<Record<ButtonVariant, { icon: LucideIcon; className: string }>> = {
  default: { icon: Landmark, className: "bg-glass-50 text-fg ring-line" },
  success: { icon: BadgeCheck, className: "bg-leaf-50 text-leaf ring-leaf-200" },
  accent: { icon: HandCoins, className: "bg-signal-50 text-signal-700 ring-signal-200" },
  destructive: { icon: CircleAlert, className: "bg-danger-soft text-danger ring-[rgba(255,123,110,0.3)]" },
};

export interface ActionDialogField {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
}

/**
 * Confirmation dialog that invokes a bound server action, shows toasts and refreshes the route.
 * When `field` is given, a textarea value is passed to the action as `{ [field.name]: value }`.
 * The header shows a tone medallion derived from `confirmVariant`; override with `icon`, or hide with `icon={null}`.
 * With `stepUpPurpose`, a step-up request from the action opens the identity check and retries.
 */
export function ActionDialog<T, I = Record<string, string>>({
  trigger,
  triggerVariant = "default",
  triggerSize = "default",
  triggerIcon,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  field,
  children,
  action,
  onSuccess,
  disabled,
  eyebrow,
  icon,
  stepUpPurpose,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: "default" | "sm" | "lg";
  triggerIcon?: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  field?: ActionDialogField;
  children?: ReactNode;
  action: (input: I) => Promise<ActionResult<T>>;
  onSuccess?: (data: T) => void;
  disabled?: boolean;
  eyebrow?: string;
  icon?: LucideIcon | null;
  stepUpPurpose?: StepUpPurpose;
}) {
  const medallion = MEDALLION[confirmVariant];
  const MedallionIcon = icon === null ? null : (icon ?? medallion?.icon ?? null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stepUp = useStepUp();

  function submit() {
    setError(null);
    if (field?.required && value.trim().length < (field.minLength ?? 1)) {
      setError(field.minLength ? `Please enter at least ${field.minLength} characters.` : `${field.label} is required.`);
      return;
    }
    startTransition(async () => {
      const input = (field ? { [field.name]: value } : {}) as I;
      const result = stepUpPurpose ? await stepUp.run(stepUpPurpose, () => action(input)) : await action(input);
      if (!result.ok && result.code === "STEP_UP_REQUIRED" && stepUpPurpose) {
        setError(result.error);
        return;
      }
      if (!result.ok) {
        const fieldError = field ? result.fieldErrors?.[field.name]?.[0] : undefined;
        setError(fieldError ?? result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Done.");
      setOpen(false);
      setValue("");
      onSuccess?.(result.data);
      router.refresh();
    });
  }

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} disabled={disabled}>
          {triggerIcon}
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="gap-0">
          {MedallionIcon && (
            <span
              aria-hidden="true"
              className={cn("mb-4 flex size-11 items-center justify-center rounded-full ring-1 ring-inset", medallion?.className ?? MEDALLION.default!.className)}
            >
              <MedallionIcon className="size-5" strokeWidth={1.6} />
            </span>
          )}
          {eyebrow && <p className="eyebrow mb-1.5 text-[0.625rem] text-fg-muted">{eyebrow}</p>}
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="mt-2">{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {field && (
          <div className="grid gap-2">
            <Label htmlFor={`action-${field.name}`}>
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              id={`action-${field.name}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={field.placeholder}
              rows={4}
              aria-invalid={Boolean(error)}
              disabled={pending}
            />
            {field.hint && !error && <p className="text-xs leading-relaxed text-muted-foreground">{field.hint}</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/15 bg-danger-soft px-3 py-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant={confirmVariant} onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
      {stepUpPurpose && stepUp.dialog}
    </>
  );
}
