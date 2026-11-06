/** The builder's three-way match: invoice ↔ booking register ↔ registered agreement. */
import { formatBps, formatINR } from "../money";
import { agreedBrokeragePaise, brokerageTolerancePaise, invoicedTaxablePaise } from "./consistency";

export const MATCH_ITEMS = [
  { key: "AMOUNT", label: "Amount", description: "Invoiced taxable value matches the brokerage payable on this booking" },
  { key: "UNIT", label: "Unit", description: "Tower and unit match the booking register" },
  { key: "AGREEMENT_NUMBER", label: "Agreement number", description: "Registration number and date match the registered agreement for sale" },
  { key: "BROKERAGE", label: "Brokerage", description: "Brokerage rate or amount matches the agreement and the empanelment terms" },
] as const;

export type MatchItemKey = (typeof MATCH_ITEMS)[number]["key"];

export const MATCH_ITEM_KEYS: MatchItemKey[] = MATCH_ITEMS.map((i) => i.key);

export function isMatchItemKey(value: string): value is MatchItemKey {
  return (MATCH_ITEM_KEYS as string[]).includes(value);
}

export interface MatchSubject {
  amountPaise: bigint;
  gstAmountPaise: bigint | null;
  taxableValuePaise: bigint | null;
  bookingTower: string | null;
  bookingUnit: string | null;
  buyerInitials: string | null;
  agreementRegistrationNumber: string | null;
  agreementDate: Date | null;
  agreementValuePaise: bigint | null;
  agreementBrokerageBps: number | null;
  agreementBrokeragePaise: bigint | null;
}

export interface MatchItemView {
  key: MatchItemKey;
  label: string;
  description: string;
  /** What the invoice states, as attested. */
  invoiceValue: string;
  /** What the invoice's own agreement figures imply, where they can be compared. */
  reference: string | null;
  /** True when the platform's arithmetic agrees, false when it disagrees, null when it can't tell. */
  consistent: boolean | null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The match items with the invoice's own figures, for the builder's checklist and the stored attestation. */
export function describeMatchItems(subject: MatchSubject): MatchItemView[] {
  const taxable = invoicedTaxablePaise({ taxableValuePaise: subject.taxableValuePaise, totalPaise: subject.amountPaise, gstAmountPaise: subject.gstAmountPaise });
  const agreed = agreedBrokeragePaise(subject);
  const brokerageConsistent = taxable !== null && agreed !== null ? (taxable > agreed ? taxable - agreed : agreed - taxable) <= brokerageTolerancePaise(agreed) : null;
  const unit = [subject.bookingTower && (/^(wing|block|phase|tower)\b/i.test(subject.bookingTower) ? subject.bookingTower : `Tower ${subject.bookingTower}`), subject.bookingUnit && `Unit ${subject.bookingUnit}`, subject.buyerInitials && `Buyer ${subject.buyerInitials}`]
    .filter(Boolean)
    .join(" · ");
  const brokerage = [
    subject.agreementBrokerageBps !== null ? `${formatBps(subject.agreementBrokerageBps)} of agreement value` : null,
    subject.agreementBrokeragePaise !== null ? formatINR(subject.agreementBrokeragePaise) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return MATCH_ITEMS.map((item) => {
    switch (item.key) {
      case "AMOUNT":
        return {
          ...item,
          invoiceValue: taxable !== null ? `Taxable ${formatINR(taxable)} · total ${formatINR(subject.amountPaise)}` : `Total ${formatINR(subject.amountPaise)}`,
          reference: agreed !== null ? `Agreement brokerage ${formatINR(agreed)}` : null,
          consistent: brokerageConsistent,
        };
      case "UNIT":
        return { ...item, invoiceValue: unit || "Not stated on the invoice", reference: null, consistent: null };
      case "AGREEMENT_NUMBER":
        return {
          ...item,
          invoiceValue: subject.agreementRegistrationNumber
            ? `${subject.agreementRegistrationNumber}${subject.agreementDate ? ` · ${isoDay(subject.agreementDate)}` : ""}`
            : "Not stated on the invoice",
          reference: null,
          consistent: null,
        };
      case "BROKERAGE":
        return {
          ...item,
          invoiceValue: brokerage || "Not stated on the invoice",
          reference: subject.agreementValuePaise !== null ? `Agreement value ${formatINR(subject.agreementValuePaise)}` : null,
          consistent: brokerageConsistent,
        };
    }
  });
}

/** Stored on InvoiceApproval.attestation. */
export interface MatchAttestation {
  version: 1;
  /** Whether the programme required the match when the builder approved. */
  required: boolean;
  items: { key: MatchItemKey; label: string; invoiceValue: string }[];
}
