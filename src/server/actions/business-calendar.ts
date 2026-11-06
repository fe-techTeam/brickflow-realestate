"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import { addBusinessHoliday, removeBusinessHoliday } from "../services/business-calendar";

export async function addBusinessHolidayAction(input: { date: string; name: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const holiday = await addBusinessHoliday(await requireActor(), input);
    revalidatePath("/admin/financing");
    return { id: holiday.id };
  }, "Holiday added to the business calendar.");
}

export async function removeBusinessHolidayAction(holidayId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeBusinessHoliday(await requireActor(), holidayId);
    revalidatePath("/admin/financing");
    return undefined;
  }, "Holiday removed from the business calendar.");
}
