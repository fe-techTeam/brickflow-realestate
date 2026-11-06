"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NotificationChannel } from "@/generated/prisma/enums";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction, saveNotificationSettingsAction } from "@/server/actions/notifications";
import type { NotificationSettings, PreferenceMatrix } from "@/server/notifications/inbox";

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationsReadAction("all");
          if (!result.ok) return void toast.error(result.error);
          toast.success(result.data.updated === 1 ? "1 notification marked as read." : `${result.data.updated} notifications marked as read.`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
      Mark all as read
    </Button>
  );
}

/** Row actions: open the related record (marking it read) or just mark it read. */
export function NotificationRowActions({ id, link, read }: { id: string; link: string | null; read: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const markRead = (then?: () => void) =>
    startTransition(async () => {
      const result = await markNotificationsReadAction([id]);
      if (!result.ok) return void toast.error(result.error);
      if (then) then();
      else router.refresh();
    });
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {!read && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => markRead()} aria-label="Mark as read">
          <Check className="size-3.5" />
          <span className="hidden sm:inline">Mark read</span>
        </Button>
      )}
      {link && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => (read ? router.push(link) : markRead(() => router.push(link)))}>
          Open
          <ArrowUpRight className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/** Channel × category switches, plus the WhatsApp number and consent that WhatsApp messages require. */
export function PreferencesForm({ initial, whatsappAvailable }: { initial: NotificationSettings; whatsappAvailable: boolean }) {
  const router = useRouter();
  const [matrix, setMatrix] = useState<PreferenceMatrix>(initial.preferences);
  const [number, setNumber] = useState(initial.whatsappNumber ?? "");
  const [consent, setConsent] = useState(initial.whatsappOptedIn);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const channels = NOTIFICATION_CHANNEL_KEYS.filter((c) => c !== "WHATSAPP" || whatsappAvailable);
  const whatsappReady = consent && number.trim().length > 0;

  function toggle(category: NotificationCategory, channel: NotificationChannel, value: boolean) {
    setMatrix((m) => ({ ...m, [category]: { ...m[category], [channel]: value } }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const preferences = Object.fromEntries(
        NOTIFICATION_CATEGORY_KEYS.map((category) => [
          category,
          Object.fromEntries(channels.map((channel) => [channel, channel === "WHATSAPP" && !whatsappReady ? false : matrix[category][channel]])),
        ]),
      );
      const result = await saveNotificationSettingsAction({
        preferences,
        whatsappNumber: whatsappAvailable ? number : initial.whatsappNumber,
        whatsappConsent: whatsappAvailable ? consent : initial.whatsappOptedIn,
      });
      if (!result.ok) {
        const field = result.fieldErrors?.whatsappNumber?.[0] ?? result.fieldErrors?.whatsappConsent?.[0];
        setError(field ?? result.error);
        toast.error(result.error);
        return;
      }
      setMatrix(result.data.preferences);
      setNumber(result.data.whatsappNumber ?? "");
      setConsent(result.data.whatsappOptedIn);
      toast.success(result.message ?? "Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="-mx-5 overflow-x-auto sm:-mx-6">
        <table className="w-full min-w-[20rem] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Notification channels for each category</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-glass-100 px-5 py-3 text-left text-[0.65rem] font-semibold tracking-[0.11em] text-fg-muted/85 uppercase sm:px-6">
                Category
              </th>
              {channels.map((channel) => (
                <th key={channel} scope="col" className="w-16 border-b border-border bg-glass-100 px-2 py-3 text-center sm:w-24 sm:px-3 text-[0.65rem] font-semibold tracking-[0.11em] text-fg-muted/85 uppercase last:pr-5 sm:last:pr-6">
                  {NOTIFICATION_CHANNELS[channel].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORY_KEYS.map((category) => (
              <tr key={category}>
                <th scope="row" className="border-b hairline px-5 py-3.5 text-left align-top font-normal sm:px-6">
                  <span className="block text-sm font-medium text-fg">{NOTIFICATION_CATEGORIES[category].label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{NOTIFICATION_CATEGORIES[category].description}</span>
                </th>
                {channels.map((channel) => {
                  const disabled = pending || (channel === "WHATSAPP" && !whatsappReady);
                  const id = `pref-${category}-${channel}`;
                  return (
                    <td key={channel} className="border-b hairline px-2 py-3.5 text-center sm:px-3 align-middle last:pr-5 sm:last:pr-6">
                      <Checkbox
                        id={id}
                        checked={channel === "WHATSAPP" && !whatsappReady ? false : matrix[category][channel]}
                        disabled={disabled}
                        onCheckedChange={(v) => toggle(category, channel, v === true)}
                        aria-label={`${NOTIFICATION_CHANNELS[channel].label} notifications for ${NOTIFICATION_CATEGORIES[category].label}`}
                        className="mx-auto"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {whatsappAvailable && (
        <fieldset className="grid gap-4 rounded-lg border border-border bg-glass-50 p-4 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-start sm:gap-6">
          <legend className="sr-only">WhatsApp</legend>
          <div className="grid gap-2">
            <Label htmlFor="whatsapp-number">WhatsApp number</Label>
            <Input
              id="whatsapp-number"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              disabled={pending}
              aria-invalid={Boolean(error)}
            />
          </div>
          <label htmlFor="whatsapp-consent" className="flex cursor-pointer items-start gap-3 text-[0.8125rem] leading-relaxed text-fg-soft sm:pt-6">
            <Checkbox id="whatsapp-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} disabled={pending} className="mt-0.5" />
            <span>I agree to receive BrickFlow updates for the categories I select on WhatsApp at this number. I can withdraw consent at any time by clearing this box.</span>
          </label>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger/15 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className={cn("flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between")}>
        <p className="text-xs text-muted-foreground">Account emails, such as password resets, are always sent.</p>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save preferences
        </Button>
      </div>
    </div>
  );
}
