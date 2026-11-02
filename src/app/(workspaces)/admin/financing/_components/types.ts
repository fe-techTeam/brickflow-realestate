import type { ProgrammeStatus } from "@/generated/prisma/enums";

export interface ProgrammeFormValues {
  name: string;
  discountRate: string;
  status: ProgrammeStatus;
  effectiveFrom: string;
  effectiveTo: string;
  offerValidityDays: string;
  terms: string;
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
