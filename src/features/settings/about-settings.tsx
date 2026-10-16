import { useWorkspaceContext } from "@/app/workspace-provider";
import { InfoRow } from "@/components/ui/inspector-section";
import { SettingsSectionCard } from "@/features/settings/settings-layout";

export function AboutSettings() {
  const { catalog, connection } = useWorkspaceContext();
  return (
    <SettingsSectionCard title="AgentChat">
      <InfoRow label="应用" value="AgentChat" />
      <InfoRow label="Runner 运行时" value={`Node ${connection.runtimeVersion || "—"}`} />
      <InfoRow
        label="数据目录"
        value={<span className="break-all">{catalog.configuration?.dataDir ?? "—"}</span>}
      />
      <p className="text-muted-foreground text-xs leading-5">
        AgentChat 围绕 pi-durable 构建：Bot 配置与对话记录由本机 Runner 管理，界面只负责展示与操作。
      </p>
    </SettingsSectionCard>
  );
}
