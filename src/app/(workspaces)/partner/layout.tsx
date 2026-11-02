import type { ReactNode } from "react";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { CONSENT_TEXT } from "@/server/services/financing";
import { OfferCenterProvider } from "./_components/offer-center";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceLayout workspace="partner">
      <OfferCenterProvider consentText={CONSENT_TEXT}>{children}</OfferCenterProvider>
    </WorkspaceLayout>
  );
}
