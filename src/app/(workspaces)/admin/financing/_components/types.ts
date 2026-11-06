import type { HolidayRule, PricingMode, ProgrammeStatus } from "@/generated/prisma/enums";

export interface ProgrammeFormValues {
  name: string;
  discountRate: string;
  status: ProgrammeStatus;
  effectiveFrom: string;
  effectiveTo: string;
  offerValidityDays: string;
  terms: string;
  pricingMode: PricingMode;
  minTenorDays: string;
  maxTenorDays: string;
  minDiscount: string;
  tdsDeducted: boolean;
  tdsRate: string;
  invoiceGstRate: string;
  processingFeeFlat: string;
  processingFeeRate: string;
  feeGstRate: string;
  holidayRule: HolidayRule;
}

/** Client-safe programme row used by the edit dialog and quick status actions. */
export interface ProgrammeRow {
  id: string;
  code: string;
  builderName: string;
  financierName: string;
  discountRateBps: number;
  status: ProgrammeStatus;
  openOffers: number;
  requests: number;
  values: ProgrammeFormValues;
}

export interface OrgOption {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}

export const PROGRAMME_STATUS_OPTIONS: { value: ProgrammeStatus; label: string; hint: string }[] = [
  { value: "DRAFT", label: "Draft", hint: "Configured but not yet offered to channel partners" },
  { value: "ACTIVE", label: "Active", hint: "Live: offers are priced at this rate" },
  { value: "SUSPENDED", label: "Suspended", hint: "Temporarily paused; no new offers" },
  { value: "CLOSED", label: "Closed", hint: "Ended; kept for history" },
];

export const PRICING_MODE_OPTIONS: { value: PricingMode; label: string; hint: string }[] = [
  { value: "FLAT_PERCENT", label: "Flat percentage", hint: "One percentage of the financed amount, whatever the days to the due date" },
  { value: "ANNUAL_RATE", label: "Annual rate", hint: "Annual rate × days to the settlement date ÷ 365; offers are repriced daily" },
];

export const HOLIDAY_RULE_OPTIONS: { value: HolidayRule; label: string; hint: string }[] = [
  { value: "NONE", label: "Keep the due date", hint: "Settlement falls due on the invoice due date" },
  { value: "NEXT_BUSINESS_DAY", label: "Next business day", hint: "A due date on a Sunday, 2nd/4th Saturday or holiday moves to the next business day" },
];
