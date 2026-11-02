"use server";

import { revalidatePath } from "next/cache";
import type { RecordStatus } from "@/generated/prisma/enums";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import {
  createProgramme,
  setOrganisationStatus,
  setUserStatus,
  updateProgramme,
  updateSettings,
  type CreateProgrammeInput,
  type SettingKey,
  type UpdateProgrammeInput,
} from "../services/admin";

function refresh() {
  revalidatePath("/", "layout");
}

export async function createProgrammeAction(input: CreateProgrammeInput): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const programme = await createProgramme(await requireActor(), input);
    refresh();
    return { id: programme.id, code: programme.code };
  }, "Financing programme created.");
}

export async function updateProgrammeAction(programmeId: string, input: UpdateProgrammeInput): Promise<ActionResult<{ openOffersWithdrawn: number }>> {
  return runAction(async () => {
    const result = await updateProgramme(await requireActor(), programmeId, input);
    refresh();
    return { openOffersWithdrawn: result.openOffersWithdrawn };
  }, "Programme updated. Previously accepted financing requests keep their agreed terms.");
}

export async function setOrganisationStatusAction(organisationId: string, status: RecordStatus): Promise<ActionResult> {
  return runAction(async () => {
    await setOrganisationStatus(await requireActor(), organisationId, status);
    refresh();
    return undefined;
  }, status === "ACTIVE" ? "Organisation activated." : "Organisation deactivated.");
}

export async function setUserStatusAction(userId: string, status: RecordStatus): Promise<ActionResult> {
  return runAction(async () => {
    await setUserStatus(await requireActor(), userId, status);
    refresh();
    return undefined;
  }, status === "ACTIVE" ? "User activated." : "User deactivated.");
}

export async function updateSettingsAction(values: Partial<Record<SettingKey, string>>): Promise<ActionResult> {
  return runAction(async () => {
    await updateSettings(await requireActor(), values);
    refresh();
    return undefined;
  }, "Settings saved.");
}
