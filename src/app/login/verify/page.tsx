import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { qrMatrix } from "@/server/auth/qr";
import { getActor, pendingMfaClaims } from "@/server/auth/session";
import { WORKSPACES } from "@/lib/workspaces";
import { DomainError } from "@/server/errors";
import { startLoginEnrolment } from "@/server/services/auth";
import { CancelSignIn, LoginEnrolment, MfaChallengeForm } from "./verify-forms";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function VerifyPage() {
  const actor = await getActor();
  if (actor) redirect(WORKSPACES[actor.workspace].basePath);
  const claims = await pendingMfaClaims();
  if (!claims) redirect("/login");

  let body: React.ReactNode;
  let title: string;
  let lede: string;
  if (claims.purpose === "challenge") {
    title = "Enter your code";
    lede = "Open your authenticator app and enter the 6-digit code for BrickFlow.";
    body = <MfaChallengeForm />;
  } else {
    title = "Set up two-step verification";
    lede = "Your role requires a second sign-in step. Link an authenticator app on your phone to continue.";
    const secret = await startLoginEnrolment(claims).catch((error: unknown) => {
      if (error instanceof DomainError) return error;
      throw error;
    });
    body =
      secret instanceof DomainError ? (
        <p role="alert" className="rounded-lg border border-danger/15 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {secret.message}
        </p>
      ) : (
        <LoginEnrolment email={secret.email} secret={{ manualKey: secret.manualKey, otpauthUri: secret.otpauthUri, qr: qrMatrix(secret.otpauthUri) }} />
      );
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <div aria-hidden="true" className="blueprint-grid-ink pointer-events-none absolute inset-0 [mask-image:linear-gradient(180deg,#000,transparent_40%)]" />
      <header className="relative px-5 pt-7 sm:px-10">
        <Logo />
      </header>
      <main className="relative flex flex-1 items-start justify-center px-5 py-10 sm:px-10 sm:py-16">
        <div className={claims.purpose === "enrol" ? "w-full max-w-[36rem] animate-fade-up" : "w-full max-w-[27rem] animate-fade-up"}>
          <p className="eyebrow flex items-center gap-3 text-fg-muted">
            <span aria-hidden="true" className="h-px w-7 bg-haze" />
            <ShieldCheck className="size-3.5" strokeWidth={1.75} />
            Two-step verification
          </p>
          <h1 className="display-title mt-4">{title}</h1>
          <p className="mt-2.5 mb-8 text-[0.9375rem] leading-relaxed text-muted-foreground">{lede}</p>
          <div className="surface p-5 sm:p-7">{body}</div>
          <CancelSignIn />
        </div>
      </main>
    </div>
  );
}
