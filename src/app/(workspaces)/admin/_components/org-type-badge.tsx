import type { OrganisationType } from "@/generated/prisma/enums";
import { ToneBadge } from "@/components/common/status-badge";
import { ORG_TYPE_META } from "./labels";

export function OrgTypeBadge({ type, className }: { type: OrganisationType; className?: string }) {
  return <ToneBadge meta={ORG_TYPE_META[type]} className={className} />;
}
