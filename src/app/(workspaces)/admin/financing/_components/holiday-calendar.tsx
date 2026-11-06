"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, CalendarPlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dayOfWeek, formatCalendarDate } from "@/lib/calendar";
import { addBusinessHolidayAction, removeBusinessHolidayAction } from "@/server/actions/business-calendar";
import { Empty, Panel } from "../../_components/editorial";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface HolidayItem {
  id: string;
  date: string;
  name: string;
  weeklyOff: boolean;
}

/** Admin-maintained bank holidays used to roll settlement due dates for programmes that ask for it. */
export function HolidayCalendar({ holidays }: { holidays: HolidayItem[] }) {
  const router = useRouter();
  const uid = useId();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await addBusinessHolidayAction({ date, name });
      if (!result.ok) {
        setErrors({ date: result.fieldErrors?.date?.[0], name: result.fieldErrors?.name?.[0], form: result.fieldErrors ? undefined : result.error });
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Holiday added.");
      setDate("");
      setName("");
      router.refresh();
    });
  }

  return (
    <Panel
      eyebrow="Business calendar"
      title="Bank holidays"
      description="Sundays and the second and fourth Saturdays are always non-business days. Holidays listed here are added to them; programmes set to roll to the next business day move settlement due dates that fall on any of these."
      className="mb-12"
      bodyClassName="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="min-w-0">
        {holidays.length === 0 ? (
          <Empty icon={CalendarOff} title="No upcoming holidays" description="Add the bank holidays your programmes should observe." />
        ) : (
          <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{h.name}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {formatCalendarDate(h.date)} · {WEEKDAYS[dayOfWeek(h.date)]}
                    {h.weeklyOff ? " · already a weekly closure" : ""}
                  </p>
                </div>
                <ActionDialog
                  trigger={<span className="sr-only">Remove {h.name}</span>}
                  triggerVariant="ghost"
                  triggerSize="sm"
                  triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
                  title="Remove holiday"
                  description={`${h.name} on ${formatCalendarDate(h.date)} will no longer be treated as a non-business day. Settlements already opened keep their due dates.`}
                  confirmLabel="Remove holiday"
                  confirmVariant="destructive"
                  action={() => removeBusinessHolidayAction(h.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submit} noValidate className="grid content-start gap-4 rounded-lg border border-border/80 bg-glass/50 p-4">
        <p className="text-sm font-semibold text-fg">Add a holiday</p>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-date`}>Date</Label>
          <Input
            id={`${uid}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={Boolean(errors.date)}
            className="tabular h-10 bg-card"
            disabled={pending}
          />
          {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-name`}>Name</Label>
          <Input
            id={`${uid}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Diwali (Lakshmi Puja)"
            maxLength={80}
            aria-invalid={Boolean(errors.name)}
            className="h-10 bg-card"
            disabled={pending}
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}
        <Button type="submit" variant="outline" disabled={pending} className="bg-card">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
          Add holiday
        </Button>
      </form>
    </Panel>
  );
}
