/**
 * Transition tables for the three lifecycle statuses. Services must move a record only along an
 * edge listed here; `assertTransition` guards each move and `sourcesFor` builds the expected-status
 * filter for conditional updates.
 */

import type { FinancingStatus, InvoiceStatus, SettlementStatus } from "@/generated/prisma/enums";
import { compareCalendarDates, istToday, toCalendarDate } from "./calendar";

export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "ACCEPTED", "REJECTED", "CLARIFICATION_REQUESTED"],
  UNDER_REVIEW: ["ACCEPTED", "REJECTED", "CLARIFICATION_REQUESTED"],
  CLARIFICATION_REQUESTED: ["SUBMITTED"],
  ACCEPTED: [],
  REJECTED: [],
};

/**
 * Shared by `Invoice.financingStatus` and `FinancingRequest.status`. OFFER_GENERATED may return to
 * NOT_REQUESTED when an open offer is withdrawn, and may repeat when a fresh offer replaces one.
 * ACCEPTED_BY_CP is recorded as an event only; the request is created directly in PENDING_APPROVAL.
 */
export const FINANCING_TRANSITIONS: Readonly<Record<FinancingStatus, readonly FinancingStatus[]>> = {
  NOT_REQUESTED: ["OFFER_GENERATED"],
  REQUESTED: ["OFFER_GENERATED"],
  OFFER_GENERATED: ["OFFER_GENERATED", "NOT_REQUESTED", "ACCEPTED_BY_CP", "PENDING_APPROVAL"],
  ACCEPTED_BY_CP: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["DISBURSEMENT_INITIATED"],
  DISBURSEMENT_INITIATED: ["DISBURSED"],
  DISBURSED: [],
  REJECTED: [],
};

/** Time only moves forward, so derived statuses never step back (e.g. OVERDUE never returns to DUE). */
export const SETTLEMENT_TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  NOT_DUE: ["DUE", "OVERDUE", "SETTLED"],
  DUE: ["OVERDUE", "SETTLED"],
  OVERDUE: ["SETTLED"],
  SETTLED: [],
};

const MACHINES = {
  invoice: INVOICE_TRANSITIONS,
  financing: FINANCING_TRANSITIONS,
  settlement: SETTLEMENT_TRANSITIONS,
} as const;

type Machines = typeof MACHINES;
export type MachineName = keyof Machines;
export type StatusOf<M extends MachineName> = keyof Machines[M] & string;

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: MachineName,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${machine} status transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition<M extends MachineName>(machine: M, from: StatusOf<M>, to: StatusOf<M>): boolean {
  const table = MACHINES[machine] as Readonly<Record<string, readonly string[]>>;
  return table[from]?.includes(to) ?? false;
}

export function assertTransition<M extends MachineName>(machine: M, from: StatusOf<M>, to: StatusOf<M>): void {
  if (!canTransition(machine, from, to)) throw new IllegalTransitionError(machine, from, to);
}

/** Every status from which `to` may be reached, optionally narrowed to `among`. */
export function sourcesFor<M extends MachineName>(machine: M, to: StatusOf<M>, among?: readonly StatusOf<M>[]): StatusOf<M>[] {
  const table = MACHINES[machine] as Readonly<Record<string, readonly string[]>>;
  const sources = Object.keys(table).filter((from) => table[from]!.includes(to)) as StatusOf<M>[];
  return among ? sources.filter((s) => among.includes(s)) : sources;
}

export function isTerminal<M extends MachineName>(machine: M, status: StatusOf<M>): boolean {
  const table = MACHINES[machine] as Readonly<Record<string, readonly string[]>>;
  return (table[status]?.length ?? 0) === 0;
}

/** Status of an unsettled obligation on the IST calendar: NOT_DUE before the due date, DUE on it, OVERDUE after. */
export function deriveSettlementStatus(dueDate: Date, now: Date = new Date()): Exclude<SettlementStatus, "SETTLED"> {
  const order = compareCalendarDates(istToday(now), toCalendarDate(dueDate));
  if (order < 0) return "NOT_DUE";
  if (order === 0) return "DUE";
  return "OVERDUE";
}
