"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSettingsAction } from "@/server/actions/admin";
import type { SettingKey } from "@/server/services/admin";

export interface SettingField {
  key: SettingKey;
  label: string;
  description: string;
  defaultValue: string;
}

const INPUT_PROPS: Record<SettingKey, { type: string; inputMode?: "numeric" | "email"; multiline?: boolean; maxLength?: number }> = {
  "platform.supportEmail": { type: "email", inputMode: "email", maxLength: 254 },
  "platform.defaultCreditPeriodDays": { type: "number", inputMode: "numeric" },
  "platform.demoBanner": { type: "text", multiline: true, maxLength: 200 },
};

export function SettingsForm({ fields, initial }: { fields: SettingField[]; initial: Record<SettingKey, string> }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();
  const dirty = fields.some((f) => values[f.key] !== initial[f.key]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const changed = Object.fromEntries(fields.filter((f) => values[f.key] !== initial[f.key]).map((f) => [f.key, values[f.key]]));
      const result = await updateSettingsAction(changed);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Settings saved.", { description: "Changes apply across every workspace immediately." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {fields.map((field) => {
        const id = `setting-${field.key.replace(/\W/g, "-")}`;
        const props = INPUT_PROPS[field.key];
        const error = errors[field.key]?.[0];
        const common = {
          id,
          value: values[field.key],
          disabled: pending,
          "aria-invalid": Boolean(error),
          "aria-describedby": `${id}-help`,
          maxLength: props.maxLength,
        };
        return (
          <div key={field.key} className="grid gap-2 sm:grid-cols-[16rem_1fr] sm:gap-6">
            <div>
              <Label htmlFor={id}>{field.label}</Label>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{field.description}</p>
            </div>
            <div className="grid gap-1.5">
              {props.multiline ? (
                <Textarea {...common} rows={3} onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))} />
              ) : (
                <Input
                  {...common}
                  type={props.type}
                  inputMode={props.inputMode}
                  min={props.type === "number" ? 1 : undefined}
                  max={props.type === "number" ? 365 : undefined}
                  className="h-9 sm:max-w-md"
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              )}
              <p id={`${id}-help`} role={error ? "alert" : undefined} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {error ??
                  (props.maxLength && props.multiline
                    ? `${values[field.key].length}/${props.maxLength} characters · default: “${field.defaultValue}”`
                    : `Default: ${field.defaultValue}`)}
              </p>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border/80 pt-5">
        <Button
          type="button"
          variant="outline"
          disabled={pending || !dirty}
          onClick={() => {
            setValues(initial);
            setErrors({});
          }}
        >
          <RotateCcw className="size-4" />
          Discard changes
        </Button>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save settings
        </Button>
      </div>
    </form>
  );
}
