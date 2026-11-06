import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  deriveSettlementStatus,
  FINANCING_TRANSITIONS,
  IllegalTransitionError,
  INVOICE_TRANSITIONS,
  isTerminal,
  SETTLEMENT_TRANSITIONS,
  sourcesFor,
} from "./state-machines";

describe("transition tables", () => {
  it.each([
    ["invoice", "SUBMITTED", "UNDER_REVIEW", true],
    ["invoice", "SUBMITTED", "ACCEPTED", true],
    ["invoice", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", true],
    ["invoice", "CLARIFICATION_REQUESTED", "SUBMITTED", true],
    ["invoice", "ACCEPTED", "REJECTED", false],
    ["invoice", "REJECTED", "SUBMITTED", false],
    ["invoice", "CLARIFICATION_REQUESTED", "ACCEPTED", false],
    ["financing", "NOT_REQUESTED", "OFFER_GENERATED", true],
    ["financing", "OFFER_GENERATED", "OFFER_GENERATED", true],
    ["financing", "OFFER_GENERATED", "NOT_REQUESTED", true],
    ["financing", "OFFER_GENERATED", "PENDING_APPROVAL", true],
    ["financing", "NOT_REQUESTED", "PENDING_APPROVAL", false],
    ["financing", "PENDING_APPROVAL", "APPROVED", true],
    ["financing", "PENDING_APPROVAL", "REJECTED", true],
    ["financing", "PENDING_APPROVAL", "DISBURSED", false],
    ["financing", "APPROVED", "REJECTED", false],
    ["financing", "APPROVED", "DISBURSEMENT_INITIATED", true],
    ["financing", "DISBURSEMENT_INITIATED", "DISBURSED", true],
    ["financing", "DISBURSED", "APPROVED", false],
    ["financing", "REJECTED", "OFFER_GENERATED", false],
    ["settlement", "NOT_DUE", "DUE", true],
    ["settlement", "NOT_DUE", "OVERDUE", true],
    ["settlement", "DUE", "OVERDUE", true],
    ["settlement", "OVERDUE", "SETTLED", true],
    ["settlement", "OVERDUE", "DUE", false],
    ["settlement", "DUE", "NOT_DUE", false],
    ["settlement", "SETTLED", "OVERDUE", false],
  ] as const)("%s: %s → %s is %s", (machine, from, to, allowed) => {
    expect(canTransition(machine, from as never, to as never)).toBe(allowed);
    if (allowed) expect(() => assertTransition(machine, from as never, to as never)).not.toThrow();
    else expect(() => assertTransition(machine, from as never, to as never)).toThrow(IllegalTransitionError);
  });

  it("covers every status in every table", () => {
    expect(Object.keys(INVOICE_TRANSITIONS).sort()).toEqual(["ACCEPTED", "CLARIFICATION_REQUESTED", "DRAFT", "REJECTED", "SUBMITTED", "UNDER_REVIEW"]);
    expect(Object.keys(FINANCING_TRANSITIONS)).toHaveLength(9);
    expect(Object.keys(SETTLEMENT_TRANSITIONS).sort()).toEqual(["DUE", "NOT_DUE", "OVERDUE", "SETTLED"]);
  });

  it("only targets statuses that exist", () => {
    for (const table of [INVOICE_TRANSITIONS, FINANCING_TRANSITIONS, SETTLEMENT_TRANSITIONS] as Record<string, readonly string[]>[]) {
      for (const targets of Object.values(table)) for (const t of targets) expect(Object.keys(table)).toContain(t);
    }
  });

  it("names the illegal move in the error", () => {
    expect(() => assertTransition("financing", "DISBURSED", "APPROVED")).toThrow("Illegal financing status transition DISBURSED → APPROVED");
  });

  it("lists the sources of a transition", () => {
    expect(sourcesFor("settlement", "SETTLED").sort()).toEqual(["DUE", "NOT_DUE", "OVERDUE"]);
    expect(sourcesFor("settlement", "OVERDUE", ["NOT_DUE", "DUE"]).sort()).toEqual(["DUE", "NOT_DUE"]);
    expect(sourcesFor("financing", "OFFER_GENERATED", ["NOT_REQUESTED", "OFFER_GENERATED"]).sort()).toEqual(["NOT_REQUESTED", "OFFER_GENERATED"]);
    expect(sourcesFor("financing", "APPROVED")).toEqual(["PENDING_APPROVAL"]);
  });

  it("identifies terminal statuses", () => {
    expect(isTerminal("financing", "DISBURSED")).toBe(true);
    expect(isTerminal("financing", "REJECTED")).toBe(true);
    expect(isTerminal("settlement", "SETTLED")).toBe(true);
    expect(isTerminal("invoice", "ACCEPTED")).toBe(true);
    expect(isTerminal("settlement", "OVERDUE")).toBe(false);
  });
});

describe("deriveSettlementStatus on the IST calendar", () => {
  const due = new Date("2026-11-03T00:00:00.000Z");

  it.each([
    ["2026-11-02T10:00:00.000Z", "NOT_DUE", "the afternoon before in India"],
    ["2026-11-02T18:29:59.999Z", "NOT_DUE", "one millisecond before IST midnight"],
    ["2026-11-02T18:30:00.000Z", "DUE", "IST midnight of the due date (previously NOT_DUE until 05:30 IST)"],
    ["2026-11-02T23:59:00.000Z", "DUE", "05:29 IST on the due date (previously NOT_DUE)"],
    ["2026-11-03T12:00:00.000Z", "DUE", "evening of the due date"],
    ["2026-11-03T18:29:59.999Z", "DUE", "last millisecond of the due date in IST"],
    ["2026-11-03T18:30:00.000Z", "OVERDUE", "IST midnight after the due date (previously DUE until 05:30 IST)"],
    ["2027-01-01T00:00:00.000Z", "OVERDUE", "weeks later"],
  ] as const)("at %s it is %s (%s)", (instant, status, _label) => {
    void _label;
    expect(deriveSettlementStatus(due, new Date(instant))).toBe(status);
  });
});
