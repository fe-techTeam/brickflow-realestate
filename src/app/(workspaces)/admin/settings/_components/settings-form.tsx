"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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
    <form onSubmit={submit} noValidate>
      <div className="divide-y divide-border/70 border-t border-border/70">
        {fields.map((field) => {
          const id = `setting-${field.key.replace(/\W/g, "-")}`;
          const props = INPUT_PROPS[field.key];
          const error = errors[field.key]?.[0];
          const changed = values[field.key] !== initial[field.key];
          const common = {
            id,
            value: values[field.key],
            disabled: pending,
            "aria-invalid": Boolean(error),
            "aria-describedby": `${id}-help`,
            maxLength: props.maxLength,
          };
          return (
            <div key={field.key} className="grid gap-3 py-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
              <div>
                <Label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-navy">
                  {field.label}
                  {changed && (
                    <>
                      <span className="size-1.5 rounded-full bg-gold" aria-hidden="true" />
                      <span className="sr-only">(changed)</span>
                    </>
                  )}
                </Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{field.description}</p>
              </div>
              <div className="grid gap-1.5">
                {props.multiline ? (
                  <Textarea {...common} rows={3} className="bg-card leading-relaxed" onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))} />
                ) : (
                  <Input
                    {...common}
                    type={props.type}
                    inputMode={props.inputMode}
                    min={props.type === "number" ? 1 : undefined}
                    max={props.type === "number" ? 365 : undefined}
                    className={cn("h-10 bg-card md:max-w-md", props.type === "number" && "tabular md:max-w-40")}
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
      </div>
      <div className="-mx-5 -mb-6 flex flex-col-reverse gap-3 border-t border-border/80 bg-ivory/50 px-5 py-4 sm:-mx-7 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {dirty ? (
            <span className="inline-flex items-center gap-2 font-medium text-gold-600">
              <span className="size-1.5 rounded-full bg-gold" aria-hidden="true" />
              Unsaved changes
            </span>
          ) : (
            "All preferences are saved."
          )}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="bg-card"
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
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 text-gold" />}
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}
