import type { Metadata } from "next";
import { History } from "lucide-react";
import { DemoBadge } from "@/components/common/status-badge";
import { requireWorkspace } from "@/server/auth/session";
import { getEnvironmentInfo } from "@/server/queries/admin";
import { getSettings, SETTING_DEFINITIONS, type SettingKey } from "@/server/services/admin";
import { AdminHeader, FactList, Note, Panel } from "../_components/editorial";
import { SettingsForm, type SettingField } from "./_components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireWorkspace("admin");
  const settings = await getSettings();
  const env = getEnvironmentInfo(actor);
  const fields: SettingField[] = (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => ({
    key,
    label: SETTING_DEFINITIONS[key].label,
    description: SETTING_DEFINITIONS[key].description,
    defaultValue: SETTING_DEFINITIONS[key].default,
  }));

  return (
    <>
      <AdminHeader eyebrow="Platform · Preferences" title="Settings" lede="Platform-wide preferences, applied to every workspace as soon as they are saved." />
      <div className="grid gap-6 xl:grid-cols-12">
        <Panel className="xl:col-span-8" eyebrow="Preferences" title="Platform preferences" description="Each change is validated on the server before it takes effect.">
          <SettingsForm fields={fields} initial={settings} />
        </Panel>
        <div className="grid content-start gap-6 xl:col-span-4">
          <Panel eyebrow="Deployment" title="Environment" description="Read-only details of this deployment." actions={<DemoBadge />}>
            <FactList
              className="[&>div]:sm:grid-cols-1 [&>div]:sm:gap-1"
              facts={[
                { label: "Application version", value: <span className="tabular font-mono text-[0.8125rem] text-fg">v{env.appVersion}</span> },
                { label: "Runtime", value: `Node.js ${env.nodeVersion} · ${env.environment}` },
                { label: "Database", value: env.database },
                { label: "Document storage", value: env.storageDriver === "local" ? "Local file system (local driver)" : env.storageDriver },
                { label: "Disbursements", value: "Simulated: no bank integration, no real funds move" },
                { label: "Discount pricing", value: "Fixed rate per builder programme, set in Financing configuration" },
              ]}
            />
          </Panel>
          <Note icon={History}>Every saved change is written to the audit log under your name, with the values that were set.</Note>
        </div>
      </div>
    </>
  );
}
