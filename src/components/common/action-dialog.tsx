"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import type { ActionResult } from "@/server/action-result";

type ButtonVariant = "default" | "gold" | "success" | "outline" | "secondary" | "ghost" | "destructive" | "link";

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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (field?.required && value.trim().length < (field.minLength ?? 1)) {
      setError(field.minLength ? `Please enter at least ${field.minLength} characters.` : `${field.label} is required.`);
      return;
    }
    startTransition(async () => {
      const result = await action((field ? { [field.name]: value } : {}) as I);
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
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold text-navy">{title}</DialogTitle>
          {description && <DialogDescription className="text-sm leading-relaxed">{description}</DialogDescription>}
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
            {field.hint && !error && <p className="text-xs text-muted-foreground">{field.hint}</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
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
  );
}
