"use client";

import { Power, PowerOff } from "lucide-react";
import type { OrganisationType, RecordStatus } from "@/generated/prisma/enums";
import { ActionDialog } from "@/components/common/action-dialog";
import { setOrganisationStatusAction, setUserStatusAction } from "@/server/actions/admin";

function organisationImpact(type: OrganisationType | undefined): string {
  switch (type) {
    case "BUILDER":
      return "Its users can no longer sign in, channel partners cannot submit new invoices to it, and new financing offers stop.";
    case "CHANNEL_PARTNER":
      return "Its users can no longer sign in, so no new invoices or early-payment requests can be raised.";
    case "FINANCIER":
      return "Its users can no longer sign in and programmes it funds stop producing new financing offers.";
    default:
      return "Its users can no longer sign in.";
  }
}

/** Activate / deactivate control for an organisation or a user, with a confirmation step. */
export function RecordStatusToggle({
  kind,
  id,
  name,
  status,
  orgType,
  size = "sm",
}: {
  kind: "organisation" | "user";
  id: string;
  name: string;
  status: RecordStatus;
  orgType?: OrganisationType;
  size?: "sm" | "default";
}) {
  const next: RecordStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  const deactivating = next === "INACTIVE";
  const action = kind === "organisation" ? () => setOrganisationStatusAction(id, next) : () => setUserStatusAction(id, next);

  const description =
    kind === "organisation"
      ? deactivating
        ? `${organisationImpact(orgType)} Existing invoices, financing requests and settlements are preserved and remain visible.`
        : "Its users will be able to sign in again and normal activity resumes. Programmes and empanelments keep their own status."
      : deactivating
        ? "All of the user's sessions end immediately and they cannot sign in until reactivated. Their history is preserved."
        : "The user will be able to sign in again, provided their organisation is active.";

  return (
    <ActionDialog
      trigger={deactivating ? "Deactivate" : "Activate"}
      triggerVariant={deactivating ? "outline" : "success"}
      triggerSize={size}
      triggerIcon={deactivating ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
      title={`${deactivating ? "Deactivate" : "Activate"} ${name}?`}
      description={description}
      confirmLabel={deactivating ? `Deactivate ${kind}` : `Activate ${kind}`}
      confirmVariant={deactivating ? "destructive" : "success"}
      action={action}
    />
  );
}
