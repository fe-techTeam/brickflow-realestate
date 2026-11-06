"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/server/actions/security";

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

const FIELDS = [
  { name: "currentPassword", label: "Current password", autoComplete: "current-password" },
  { name: "newPassword", label: "New password", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Confirm new password", autoComplete: "new-password" },
] as const;

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await changePasswordAction(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      setValues(EMPTY);
      const others = result.data.otherSessionsRevoked;
      toast.success("Password changed.", { description: others ? `${others} other session${others === 1 ? " was" : "s were"} signed out.` : undefined });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {FIELDS.map((field) => {
        const error = errors[field.name]?.[0];
        return (
          <div key={field.name} className="grid gap-2">
            <Label htmlFor={`password-${field.name}`}>{field.label}</Label>
            <Input
              id={`password-${field.name}`}
              name={field.name}
              type="password"
              autoComplete={field.autoComplete}
              value={values[field.name]}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              className="h-10"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `password-${field.name}-error` : field.name === "newPassword" ? "password-rules" : undefined}
              disabled={pending}
              required
            />
            {error && (
              <p id={`password-${field.name}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            {field.name === "newPassword" && !error && (
              <p id="password-rules" className="text-xs leading-relaxed text-muted-foreground">
                At least {minLength} characters. Avoid common passwords and your name; a phrase of several unrelated words works well.
              </p>
            )}
          </div>
        );
      })}
      <div className="flex flex-col gap-3 border-t hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">Your other sessions are signed out when the password changes.</p>
        <Button type="submit" disabled={pending || !values.currentPassword || !values.newPassword} className="shrink-0">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Change password
        </Button>
      </div>
    </form>
  );
}
