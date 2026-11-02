import type { Metadata } from "next";
import { DetailList, Section } from "@/components/common/panels";
import { PageHeader } from "@/components/common/page-header";
import { DemoBadge } from "@/components/common/status-badge";
import { requireWorkspace } from "@/server/auth/session";
import { getEnvironmentInfo } from "@/server/queries/admin";
import { getSettings, SETTING_DEFINITIONS, type SettingKey } from "@/server/services/admin";
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
      <PageHeader eyebrow="Platform" title="Settings" description="Platform-wide preferences. Every change is recorded in the audit log." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Platform preferences" description="Applied to all workspaces as soon as they are saved.">
          <SettingsForm fields={fields} initial={settings} />
        </Section>
        <Section title="Environment" description="Read-only details of this deployment." actions={<DemoBadge />}>
          <DetailList
            columns={1}
            items={[
              { label: "Application version", value: <span className="tabular font-mono text-xs">v{env.appVersion}</span> },
              { label: "Runtime", value: `Node.js ${env.nodeVersion} · ${env.environment}` },
              { label: "Database", value: env.database },
              { label: "Document storage", value: env.storageDriver === "local" ? "Local file system (local driver)" : env.storageDriver },
              { label: "Disbursements", value: "Simulated: no bank integration, no real funds move" },
              { label: "Discount pricing", value: "Fixed rate per builder programme, configured in Financing configuration" },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
