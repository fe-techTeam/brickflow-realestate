import { redirect } from "next/navigation";
import { WORKSPACES } from "@/lib/workspaces";
import { getActor } from "@/server/auth/session";

export default async function HomePage() {
  const actor = await getActor();
  redirect(actor ? WORKSPACES[actor.workspace].basePath : "/login");
}
