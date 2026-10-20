import { InfoRow } from "@/components/ui/inspector-section";
import { SettingsInfoList, SettingsSectionCard } from "@/features/settings/settings-layout";
import { useRunnerSettings } from "@/features/settings/use-runner-actions";

export function AboutSettings() {
  const { catalog, connection } = useRunnerSettings();
  return (
    <SettingsSectionCard title="AgentChat">
      <SettingsInfoList>
        <InfoRow label="应用" value="AgentChat" />
        <InfoRow label="Runner 运行时" value={`Node ${connection.runtimeVersion || "—"}`} />
        <InfoRow
          label="数据目录"
          value={<span className="break-all">{catalog?.configuration?.dataDir ?? "—"}</span>}
        />
      </SettingsInfoList>
    </SettingsSectionCard>
  );
}
