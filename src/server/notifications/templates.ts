import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import type { NotificationEvent } from "@/lib/notifications";
import type { WorkspaceKey } from "@/lib/workspaces";

/* ----------------------------------------------------------------------------------------------
 * Event payloads. Everything is a JSON-safe string or number: money is paise as a decimal string,
 * dates are ISO strings. The payload is stored with the delivery and rendered at send time.
 * -------------------------------------------------------------------------------------------- */

export interface InvoiceEventData {
  invoiceId: string;
  invoiceNumber: string;
  invoiceReference: string;
  amountPaise: string;
  approvedAmountPaise?: string | null;
  cpName: string;
  builderName: string;
  projectName: string;
  note?: string | null;
}

export interface OfferEventData {
  offerId: string;
  offerReference: string;
  invoiceId: string;
  invoiceNumber: string;
  approvedAmountPaise: string;
  netPayablePaise: string;
  discountRateBps: number;
  validUntil: string;
  cpName: string;
  builderName: string;
}

export interface OfferAcceptedEventData {
  requestId: string;
  requestReference: string;
  offerReference: string;
  invoiceId: string;
  invoiceNumber: string;
  netPayablePaise: string;
  cpName: string;
  builderName: string;
}

export interface FinancingDecisionEventData {
  requestId: string;
  requestReference: string;
  invoiceId: string;
  invoiceNumber: string;
  netPayablePaise: string;
  cpName: string;
  builderName: string;
  financierName: string;
  note?: string | null;
}

export interface DisbursementEventData {
  requestId: string;
  requestReference: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentReference: string;
  amountPaise: string;
  cpName: string;
  builderName: string;
  utr?: string | null;
  settlementAmountPaise?: string | null;
  settlementDueDate?: string | null;
}

export interface SettlementEventData {
  settlementId: string;
  requestId: string;
  requestReference: string;
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: string;
  dueDate: string;
  builderName: string;
  financierName: string;
  cpName: string;
  daysUntilDue?: number;
  daysOverdue?: number;
  settlementReference?: string | null;
}

export interface NotificationEventDataMap {
  "invoice.submitted": InvoiceEventData;
  "invoice.under_review": InvoiceEventData;
  "invoice.approved": InvoiceEventData;
  "invoice.rejected": InvoiceEventData;
  "invoice.clarification_requested": InvoiceEventData;
  "invoice.resubmitted": InvoiceEventData;
  "offer.generated": OfferEventData;
  "offer.expiring": OfferEventData;
  "offer.accepted": OfferAcceptedEventData;
  "financing.approved": FinancingDecisionEventData;
  "financing.rejected": FinancingDecisionEventData;
  "disbursement.initiated": DisbursementEventData;
  "disbursement.completed": DisbursementEventData;
  "settlement.due_soon": SettlementEventData;
  "settlement.due_today": SettlementEventData;
  "settlement.overdue": SettlementEventData;
  "settlement.settled": SettlementEventData;
}

/* ----------------------------------------------------------------------------------------------
 * Rendering
 * -------------------------------------------------------------------------------------------- */

export interface RenderContext {
  /** The recipient's workspace; decides which page the links open. */
  workspace: WorkspaceKey | null;
}

export interface EmailContent {
  subject: string;
  heading: string;
  intro: string;
  facts: [label: string, value: string][];
  note?: { label: string; text: string };
  cta?: { label: string; path: string };
}

export interface RenderedNotification {
  title: string;
  body: string;
  path: string | null;
  email: EmailContent;
  /** Body parameters, in order, for the approved WhatsApp template named by `whatsappTemplateName`. */
  whatsappParams: string[];
}

/** Template names registered in WhatsApp Manager; one per event, body parameters as `whatsappParams`. */
export function whatsappTemplateName(event: NotificationEvent): string {
  return `brickflow_${event.replace(/\./g, "_")}`;
}

const inr = (paise: string | null | undefined) => (paise ? formatINR(paise) : "—");
const day = (iso: string | null | undefined) => (iso ? formatDate(iso) : "—");

function invoicePath(workspace: WorkspaceKey | null, d: { invoiceId: string; requestId?: string }): string | null {
  switch (workspace) {
    case "partner":
      return `/partner/invoices/${d.invoiceId}`;
    case "builder":
      return `/builder/invoices/${d.invoiceId}`;
    case "finance":
      return d.requestId ? `/finance/requests/${d.requestId}` : "/finance/requests";
    case "admin":
      return d.requestId ? `/admin/transactions/${d.requestId}` : "/admin/transactions";
    default:
      return null;
  }
}

function settlementPath(workspace: WorkspaceKey | null, d: SettlementEventData): string | null {
  if (workspace === "builder") return "/builder/settlements";
  return invoicePath(workspace, d);
}

function invoiceFacts(d: InvoiceEventData): [string, string][] {
  return [
    ["Invoice", `${d.invoiceNumber} (${d.invoiceReference})`],
    ["Channel partner", d.cpName],
    ["Builder", d.builderName],
    ["Project", d.projectName],
    ["Invoice amount", inr(d.amountPaise)],
  ];
}

function invoiceTemplate(
  d: InvoiceEventData,
  ctx: RenderContext,
  t: { title: string; body: string; subject: string; heading: string; intro: string; noteLabel?: string; cta: string; extraFacts?: [string, string][] },
): RenderedNotification {
  const path = invoicePath(ctx.workspace, d);
  return {
    title: t.title,
    body: t.body,
    path,
    email: {
      subject: t.subject,
      heading: t.heading,
      intro: t.intro,
      facts: [...invoiceFacts(d), ...(t.extraFacts ?? [])],
      note: t.noteLabel && d.note ? { label: t.noteLabel, text: d.note } : undefined,
      cta: path ? { label: t.cta, path } : undefined,
    },
    whatsappParams: [d.invoiceNumber, d.cpName, d.builderName, inr(d.approvedAmountPaise ?? d.amountPaise)],
  };
}

type Renderers = { [E in NotificationEvent]: (data: NotificationEventDataMap[E], ctx: RenderContext) => RenderedNotification };

const RENDERERS: Renderers = {
  "invoice.submitted": (d, ctx) =>
    invoiceTemplate(d, ctx, {
      title: `New invoice ${d.invoiceNumber} from ${d.cpName}`,
      body: `${inr(d.amountPaise)} for ${d.projectName} is waiting for your review.`,
      subject: `Invoice ${d.invoiceNumber} from ${d.cpName} is awaiting review`,
      heading: "A new invoice needs your review",
      intro: `${d.cpName} submitted brokerage invoice ${d.invoiceNumber} for ${d.projectName}.`,
      cta: "Review invoice",
    }),
  "invoice.under_review": (d, ctx) =>
    invoiceTemplate(d, ctx, {
      title: `Invoice ${d.invoiceNumber} is under review`,
      body: `${d.builderName} has started reviewing your invoice.`,
      subject: `${d.builderName} is reviewing invoice ${d.invoiceNumber}`,
      heading: "Your invoice is under review",
      intro: `${d.builderName} has started reviewing invoice ${d.invoiceNumber}. We will let you know as soon as they decide.`,
      cta: "View invoice",
    }),
  "invoice.approved": (d, ctx) =>
    invoiceTemplate(d, ctx, {
      title: `Invoice ${d.invoiceNumber} approved`,
      body: `${d.builderName} approved ${inr(d.approvedAmountPaise ?? d.amountPaise)}. You can now request early payment.`,
      subject: `Invoice ${d.invoiceNumber} approved by ${d.builderName}`,
      heading: "Your invoice has been approved",
      intro: `${d.builderName} approved invoice ${d.invoiceNumber}. It is now eligible for early payment.`,
      noteLabel: "Builder's comment",
      cta: "Get early payment",
      extraFacts: [["Approved amount", inr(d.approvedAmountPaise ?? d.amountPaise)]],
    }),
  "invoice.rejected": (d, ctx) =>
    invoiceTemplate(d, ctx, {
      title: `Invoice ${d.invoiceNumber} rejected`,
      body: d.note ? `Reason: ${d.note}` : `${d.builderName} rejected the invoice.`,
      subject: `Invoice ${d.invoiceNumber} was rejected by ${d.builderName}`,
      heading: "Your invoice was rejected",
      intro: `${d.builderName} rejected invoice ${d.invoiceNumber}.`,
      noteLabel: "Reason",
      cta: "View invoice",
    }),
  "invoice.clarification_requested": (d, ctx) =>
    invoiceTemplate(d, ctx, {
      title: `Clarification requested on ${d.invoiceNumber}`,
      body: d.note ? `${d.builderName}: ${d.note}` : `${d.builderName} needs more information.`,
      subject: `${d.builderName} needs a clarification on invoice ${d.invoiceNumber}`,
      heading: "The builder needs a clarification",
      intro: `${d.builderName} has a question about invoice ${d.invoiceNumber}. Respond so the review can continue.`,
      noteLabel: "Question from the builder",
      cta: "Respond now",
    }),
  "invoice.resubmitted": (d, ctx) =>
    invoiceTemplate(d, ctx, {
      title: `${d.cpName} responded on ${d.invoiceNumber}`,
      body: "The invoice is back in your approvals inbox.",
      subject: `${d.cpName} responded to your clarification on invoice ${d.invoiceNumber}`,
      heading: "A clarification has been answered",
      intro: `${d.cpName} responded to your clarification request and resubmitted invoice ${d.invoiceNumber}.`,
      noteLabel: "Response",
      cta: "Review invoice",
    }),
  "offer.generated": (d, ctx) => {
    const path = ctx.workspace === "partner" ? "/partner/offers" : invoicePath(ctx.workspace, d);
    return {
      title: `Early-payment offer ${d.offerReference} ready`,
      body: `Receive ${inr(d.netPayablePaise)} now on invoice ${d.invoiceNumber}. Valid until ${formatDateTime(d.validUntil)}.`,
      path,
      email: {
        subject: `Your early-payment offer for invoice ${d.invoiceNumber}`,
        heading: "Your early-payment offer is ready",
        intro: `You can receive ${inr(d.netPayablePaise)} now on invoice ${d.invoiceNumber} from ${d.builderName}.`,
        facts: offerFacts(d),
        cta: path ? { label: "Review offer", path } : undefined,
      },
      whatsappParams: [d.invoiceNumber, inr(d.netPayablePaise), formatBps(d.discountRateBps), formatDateTime(d.validUntil)],
    };
  },
  "offer.expiring": (d, ctx) => {
    const path = ctx.workspace === "partner" ? "/partner/offers" : invoicePath(ctx.workspace, d);
    return {
      title: `Offer ${d.offerReference} expires soon`,
      body: `Accept before ${formatDateTime(d.validUntil)} to receive ${inr(d.netPayablePaise)} early.`,
      path,
      email: {
        subject: `Your offer on invoice ${d.invoiceNumber} expires in 24 hours`,
        heading: "Your early-payment offer expires soon",
        intro: `The offer of ${inr(d.netPayablePaise)} on invoice ${d.invoiceNumber} expires on ${formatDateTime(d.validUntil)}. After that you will need to request a fresh offer at the terms then in force.`,
        facts: offerFacts(d),
        cta: path ? { label: "Review offer", path } : undefined,
      },
      whatsappParams: [d.invoiceNumber, inr(d.netPayablePaise), formatDateTime(d.validUntil)],
    };
  },
  "offer.accepted": (d, ctx) => {
    const path = ctx.workspace === "partner" ? `/partner/invoices/${d.invoiceId}` : invoicePath(ctx.workspace, d);
    const forPartner = ctx.workspace === "partner";
    return {
      title: forPartner ? `Offer ${d.offerReference} accepted` : `New financing request ${d.requestReference}`,
      body: forPartner
        ? `Request ${d.requestReference} for ${inr(d.netPayablePaise)} is with the financier for approval.`
        : `${d.cpName} accepted an offer of ${inr(d.netPayablePaise)} on invoice ${d.invoiceNumber}.`,
      path,
      email: {
        subject: forPartner ? `Offer accepted: request ${d.requestReference} submitted` : `New financing request ${d.requestReference} from ${d.cpName}`,
        heading: forPartner ? "Your offer has been accepted" : "A financing request is awaiting approval",
        intro: forPartner
          ? `Thank you. Financing request ${d.requestReference} has been submitted for approval. We will notify you when it is decided.`
          : `${d.cpName} accepted offer ${d.offerReference} on invoice ${d.invoiceNumber} (${d.builderName}).`,
        facts: [
          ["Financing request", d.requestReference],
          ["Offer", d.offerReference],
          ["Invoice", d.invoiceNumber],
          ["Builder", d.builderName],
          ["Net payable", inr(d.netPayablePaise)],
        ],
        cta: path ? { label: forPartner ? "Track request" : "Review request", path } : undefined,
      },
      whatsappParams: [d.requestReference, d.invoiceNumber, inr(d.netPayablePaise)],
    };
  },
  "financing.approved": (d, ctx) => financingDecision(d, ctx, true),
  "financing.rejected": (d, ctx) => financingDecision(d, ctx, false),
  "disbursement.initiated": (d, ctx) => {
    const path = ctx.workspace === "partner" ? "/partner/disbursements" : invoicePath(ctx.workspace, d);
    return {
      title: `Payout ${d.paymentReference} initiated`,
      body: `${inr(d.amountPaise)} for invoice ${d.invoiceNumber} is on its way to your registered bank account.`,
      path,
      email: {
        subject: `Payout of ${inr(d.amountPaise)} initiated for invoice ${d.invoiceNumber}`,
        heading: "Your payout has been initiated",
        intro: `The financier has initiated payout ${d.paymentReference} to your registered bank account. We will confirm once the bank acknowledges the transfer.`,
        facts: disbursementFacts(d),
        cta: path ? { label: "View payout", path } : undefined,
      },
      whatsappParams: [d.paymentReference, inr(d.amountPaise), d.invoiceNumber],
    };
  },
  "disbursement.completed": (d, ctx) => {
    const forBuilder = ctx.workspace === "builder";
    const path = forBuilder ? "/builder/settlements" : ctx.workspace === "partner" ? "/partner/disbursements" : invoicePath(ctx.workspace, d);
    return {
      title: forBuilder ? `Settlement scheduled for ${d.invoiceNumber}` : `Payout ${d.paymentReference} completed`,
      body: forBuilder
        ? `${inr(d.settlementAmountPaise)} is due to the financier on ${day(d.settlementDueDate)}.`
        : `${inr(d.amountPaise)} has been credited${d.utr ? ` (UTR ${d.utr})` : ""}.`,
      path,
      email: {
        subject: forBuilder
          ? `Settlement of ${inr(d.settlementAmountPaise)} due ${day(d.settlementDueDate)} for invoice ${d.invoiceNumber}`
          : `Payout ${d.paymentReference} completed: ${inr(d.amountPaise)}`,
        heading: forBuilder ? "A settlement has been scheduled" : "Your payout is complete",
        intro: forBuilder
          ? `${d.cpName} has been paid early on invoice ${d.invoiceNumber}. Please settle the approved amount with the financier on the original due date.`
          : `The bank has confirmed payout ${d.paymentReference} for invoice ${d.invoiceNumber}.`,
        facts: [
          ...disbursementFacts(d),
          ...(forBuilder ? ([["Settlement amount", inr(d.settlementAmountPaise)], ["Settlement due", day(d.settlementDueDate)]] as [string, string][]) : []),
        ],
        cta: path ? { label: forBuilder ? "View settlements" : "View payout", path } : undefined,
      },
      whatsappParams: forBuilder
        ? [d.invoiceNumber, inr(d.settlementAmountPaise), day(d.settlementDueDate)]
        : [d.paymentReference, inr(d.amountPaise), d.utr ?? "—"],
    };
  },
  "settlement.due_soon": (d, ctx) =>
    settlementTemplate(d, ctx, {
      title: `Settlement due in ${d.daysUntilDue ?? 3} day${d.daysUntilDue === 1 ? "" : "s"}`,
      body: `${inr(d.amountPaise)} for invoice ${d.invoiceNumber} is due on ${day(d.dueDate)}.`,
      subject: `Reminder: settlement of ${inr(d.amountPaise)} due ${day(d.dueDate)}`,
      heading: "A settlement is coming due",
      intro: `The settlement for financing request ${d.requestReference} (invoice ${d.invoiceNumber}) is due on ${day(d.dueDate)}.`,
    }),
  "settlement.due_today": (d, ctx) =>
    settlementTemplate(d, ctx, {
      title: `Settlement due today: ${d.invoiceNumber}`,
      body: `${inr(d.amountPaise)} is due to ${d.financierName} today.`,
      subject: `Settlement of ${inr(d.amountPaise)} is due today`,
      heading: "A settlement is due today",
      intro: `The settlement for financing request ${d.requestReference} (invoice ${d.invoiceNumber}) is due today.`,
    }),
  "settlement.overdue": (d, ctx) =>
    settlementTemplate(d, ctx, {
      title: `Settlement overdue: ${d.invoiceNumber}`,
      body: `${inr(d.amountPaise)} was due on ${day(d.dueDate)} (${d.daysOverdue ?? 1} day${d.daysOverdue === 1 ? "" : "s"} overdue).`,
      subject: `Overdue: settlement of ${inr(d.amountPaise)} was due ${day(d.dueDate)}`,
      heading: "A settlement is overdue",
      intro: `The settlement for financing request ${d.requestReference} (invoice ${d.invoiceNumber}) was due on ${day(d.dueDate)} and has not been recorded as paid.`,
    }),
  "settlement.settled": (d, ctx) =>
    settlementTemplate(d, ctx, {
      title: `Settlement recorded for ${d.invoiceNumber}`,
      body: `${inr(d.amountPaise)} settled${d.settlementReference ? ` (ref. ${d.settlementReference})` : ""}.`,
      subject: `Settlement of ${inr(d.amountPaise)} recorded for invoice ${d.invoiceNumber}`,
      heading: "Settlement completed",
      intro: `${d.financierName} has recorded the settlement for financing request ${d.requestReference}. No further payment is due on this invoice.`,
    }),
};

function offerFacts(d: OfferEventData): [string, string][] {
  return [
    ["Offer", d.offerReference],
    ["Invoice", d.invoiceNumber],
    ["Builder", d.builderName],
    ["Approved amount", inr(d.approvedAmountPaise)],
    ["Discount rate", formatBps(d.discountRateBps)],
    ["You receive", inr(d.netPayablePaise)],
    ["Valid until", formatDateTime(d.validUntil)],
  ];
}

function disbursementFacts(d: DisbursementEventData): [string, string][] {
  return [
    ["Payout reference", d.paymentReference],
    ["Financing request", d.requestReference],
    ["Invoice", d.invoiceNumber],
    ["Amount", inr(d.amountPaise)],
    ...(d.utr ? ([["UTR", d.utr]] as [string, string][]) : []),
  ];
}

function financingDecision(d: FinancingDecisionEventData, ctx: RenderContext, approved: boolean): RenderedNotification {
  const path = invoicePath(ctx.workspace, d);
  return {
    title: approved ? `Financing approved for ${d.invoiceNumber}` : `Financing declined for ${d.invoiceNumber}`,
    body: approved
      ? `${d.financierName} approved ${inr(d.netPayablePaise)}. The payout will be initiated shortly.`
      : d.note
        ? `Reason: ${d.note}`
        : `${d.financierName} declined request ${d.requestReference}.`,
    path,
    email: {
      subject: approved ? `Financing request ${d.requestReference} approved` : `Financing request ${d.requestReference} declined`,
      heading: approved ? "Your financing request is approved" : "Your financing request was declined",
      intro: approved
        ? `${d.financierName} approved financing request ${d.requestReference} on invoice ${d.invoiceNumber}. The payout to your registered bank account will be initiated shortly.`
        : `${d.financierName} declined financing request ${d.requestReference} on invoice ${d.invoiceNumber}.`,
      facts: [
        ["Financing request", d.requestReference],
        ["Invoice", d.invoiceNumber],
        ["Builder", d.builderName],
        ["Net payable", inr(d.netPayablePaise)],
      ],
      note: d.note ? { label: approved ? "Note from the financier" : "Reason", text: d.note } : undefined,
      cta: path ? { label: "View request", path } : undefined,
    },
    whatsappParams: [d.requestReference, d.invoiceNumber, inr(d.netPayablePaise)],
  };
}

function settlementTemplate(
  d: SettlementEventData,
  ctx: RenderContext,
  t: { title: string; body: string; subject: string; heading: string; intro: string },
): RenderedNotification {
  const path = settlementPath(ctx.workspace, d);
  return {
    title: t.title,
    body: t.body,
    path,
    email: {
      subject: t.subject,
      heading: t.heading,
      intro: t.intro,
      facts: [
        ["Financing request", d.requestReference],
        ["Invoice", d.invoiceNumber],
        ["Builder", d.builderName],
        ["Financier", d.financierName],
        ["Amount", inr(d.amountPaise)],
        ["Due date", day(d.dueDate)],
        ...(d.settlementReference ? ([["Settlement reference", d.settlementReference]] as [string, string][]) : []),
      ],
      cta: path ? { label: "View settlement", path } : undefined,
    },
    whatsappParams: [d.invoiceNumber, inr(d.amountPaise), day(d.dueDate)],
  };
}

export function renderNotification<E extends NotificationEvent>(event: E, data: NotificationEventDataMap[E], ctx: RenderContext): RenderedNotification {
  const renderer = RENDERERS[event] as (data: NotificationEventDataMap[E], ctx: RenderContext) => RenderedNotification;
  if (!renderer) throw new Error(`No template for notification event "${event}"`);
  return renderer(data, ctx);
}
