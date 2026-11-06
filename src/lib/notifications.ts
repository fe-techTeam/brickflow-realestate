import type { NotificationChannel } from "@/generated/prisma/enums";

/** Event categories a user can switch per channel. */
export const NOTIFICATION_CATEGORIES = {
  invoices: { label: "Invoices", description: "Submissions, reviews, approvals, rejections and clarification requests." },
  offers: { label: "Early-payment offers", description: "New offers, expiry reminders and accepted offers." },
  financing: { label: "Financing and payouts", description: "Financing decisions, disbursements and payout confirmations." },
  settlements: { label: "Settlements", description: "Upcoming due dates, overdue notices and completed settlements." },
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export const NOTIFICATION_CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[];

export const NOTIFICATION_CHANNELS: Record<NotificationChannel, { label: string; description: string }> = {
  IN_APP: { label: "In-app", description: "The bell in the top bar and the notifications page." },
  EMAIL: { label: "Email", description: "Sent to your sign-in email address." },
  WHATSAPP: { label: "WhatsApp", description: "Template messages to your verified WhatsApp number." },
};

export const NOTIFICATION_CHANNEL_KEYS: NotificationChannel[] = ["IN_APP", "EMAIL", "WHATSAPP"];

/** WhatsApp is opt-in (business-initiated messages need the user's consent); the others are on until switched off. */
export const DEFAULT_CHANNEL_ENABLED: Record<NotificationChannel, boolean> = { IN_APP: true, EMAIL: true, WHATSAPP: false };

export const NOTIFICATION_EVENTS = {
  "invoice.submitted": { category: "invoices", label: "Invoice submitted" },
  "invoice.under_review": { category: "invoices", label: "Invoice under review" },
  "invoice.approved": { category: "invoices", label: "Invoice approved" },
  "invoice.rejected": { category: "invoices", label: "Invoice rejected" },
  "invoice.clarification_requested": { category: "invoices", label: "Clarification requested" },
  "invoice.resubmitted": { category: "invoices", label: "Invoice resubmitted" },
  "offer.generated": { category: "offers", label: "Offer generated" },
  "offer.expiring": { category: "offers", label: "Offer expiring" },
  "offer.accepted": { category: "offers", label: "Offer accepted" },
  "financing.approved": { category: "financing", label: "Financing approved" },
  "financing.rejected": { category: "financing", label: "Financing declined" },
  "disbursement.initiated": { category: "financing", label: "Disbursement initiated" },
  "disbursement.completed": { category: "financing", label: "Disbursement completed" },
  "settlement.due_soon": { category: "settlements", label: "Settlement due in 3 days" },
  "settlement.due_today": { category: "settlements", label: "Settlement due today" },
  "settlement.overdue": { category: "settlements", label: "Settlement overdue" },
  "settlement.settled": { category: "settlements", label: "Settlement completed" },
} as const satisfies Record<string, { category: NotificationCategory; label: string }>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export function isNotificationCategory(value: string): value is NotificationCategory {
  return Object.hasOwn(NOTIFICATION_CATEGORIES, value);
}

/** E.164 with country code, e.g. +919876543210. */
export const WHATSAPP_NUMBER_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normaliseWhatsappNumber(input: string): string | null {
  const compact = input.replace(/[\s()-]/g, "");
  // A bare 10-digit Indian mobile number is assumed to be +91; anything else needs a country code.
  if (/^[6-9]\d{9}$/.test(compact)) return `+91${compact}`;
  const withPlus = compact.startsWith("+") ? compact : compact.startsWith("00") ? `+${compact.slice(2)}` : null;
  if (!withPlus) return null;
  return WHATSAPP_NUMBER_PATTERN.test(withPlus) ? withPlus : null;
}
