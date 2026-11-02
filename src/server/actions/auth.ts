"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { workspaceForOrgType } from "@/lib/workspaces";
import { recordAudit } from "../audit";
import { endSession, getActor, startSession } from "../auth/session";
import { db } from "../db";
import { DomainError } from "../errors";
import { authenticate } from "../services/auth";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  let destination: string;
  try {
    const result = await authenticate({ email, password });
    await startSession(result.userId, result.membershipId);
    destination = workspaceForOrgType(result.orgType).basePath;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, email };
    if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Enter your email and password.", email };
    console.error("[auth] login failed", error);
    return { error: "Sign-in is temporarily unavailable. Please try again.", email };
  }
  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  const actor = await getActor();
  if (actor) {
    await db.$transaction(async (tx) =>
      recordAudit(tx, actor, { action: "session.logout", entityType: "Session", entityId: actor.userId, summary: `${actor.name} signed out` }),
    );
  }
  await endSession();
  redirect("/login");
}
