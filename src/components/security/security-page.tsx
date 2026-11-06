import { History, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/panels";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/format";
import type { WorkspaceKey } from "@/lib/workspaces";
import { requireWorkspace } from "@/server/auth/session";
import { getSecurityOverview, PASSWORD_MIN_LENGTH } from "@/server/services/security";
import { ChangePasswordForm } from "./change-password-form";
import { MfaPanel } from "./mfa-panel";
import { SessionsPanel } from "./sessions-panel";

/** The account Security page, shared by every workspace (mounted at `/<workspace>/security`). */
export async function SecurityPage({ workspace }: { workspace: WorkspaceKey }) {
  const actor = await requireWorkspace(workspace);
  const overview = await getSecurityOverview(actor);

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Security"
        description="Two-step verification, the devices signed in to your account, and your password."
        meta={[
          <span key="email">{actor.email}</span>,
          <span key="login">Last sign-in {formatDateTime(overview.lastLoginAt)}</span>,
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="grid content-start gap-6 xl:col-span-7">
          <Section
            eyebrow="Sign-in"
            title="Two-step verification"
            description={
              overview.mfa.required
                ? "Required for your role. Each sign-in needs your password and a code from your authenticator app."
                : "Recommended. Protects your account even if your password is exposed."
            }
          >
            <MfaPanel
              enabled={overview.mfa.enabled}
              enabledAt={overview.mfa.enabledAt?.toISOString() ?? null}
              required={overview.mfa.required}
              recoveryCodesLeft={overview.mfa.recoveryCodesLeft}
              email={actor.email}
            />
          </Section>
          <Section
            eyebrow="Devices"
            title="Active sessions"
            description="Sessions end after 30 minutes without activity and 8 hours after sign-in."
            footer={
              <span className="flex items-center gap-2">
                <History className="size-3.5" strokeWidth={1.75} />
                Sign-ins, sign-outs and security changes are recorded in the audit log.
              </span>
            }
          >
            <SessionsPanel
              sessions={overview.sessions.map((s) => ({
                id: s.id,
                createdAt: s.createdAt.toISOString(),
                lastSeenAt: s.lastSeenAt.toISOString(),
                ip: s.ip,
                userAgent: s.userAgent,
                mfaVerified: Boolean(s.mfaVerifiedAt),
                current: s.current,
              }))}
            />
          </Section>
        </div>
        <div className="grid content-start gap-6 xl:col-span-5">
          <Section
            eyebrow="Credentials"
            title="Change password"
            description={
              <span className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" strokeWidth={1.75} />
                Last changed {formatDate(overview.passwordChangedAt)}
              </span>
            }
          >
            <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />
          </Section>
        </div>
      </div>
    </>
  );
}

export function SecurityPageSkeleton() {
  return (
    <div className="animate-fade-up">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-10 grid gap-6 xl:grid-cols-12">
        <div className="grid gap-6 xl:col-span-7">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl xl:col-span-5" />
      </div>
    </div>
  );
}
