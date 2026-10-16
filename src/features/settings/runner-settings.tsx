import { useWorkspaceContext } from "@/app/workspace-provider";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/inspector-section";
import { Separator } from "@/components/ui/separator";
import { ConfigurationEditor } from "@/features/settings/configuration-editor";
import { SettingsSectionCard } from "@/features/settings/settings-layout";

export function RunnerSettings() {
  const { catalog, connection, feedback, actions } = useWorkspaceContext();
  const configuration = catalog.configuration;
  return (
    <div className="space-y-6">
      <SettingsSectionCard title="后台运行状态">
        <InfoRow
          label="本机状态"
          value={
            connection.runnerStopped
              ? "后台已停止"
              : connection.runnerUnavailable
                ? "连接失败"
                : "已连接"
          }
        />
        <p className="text-muted-foreground text-xs leading-5">
          关闭窗口或退出 UI 后，后台 Runner 继续运行。停止 Runner
          会保留未完成工作的恢复状态；取消工作需单独操作。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={connection.busy}
            onClick={() => void actions.restartRunner()}
          >
            {connection.runnerStopped ? "启动并连接" : "重新启动并连接"}
          </Button>
          <Button
            variant="outline"
            disabled={connection.busy || connection.runnerUnavailable}
            onClick={() => void actions.reloadConfiguration()}
          >
            重载配置
          </Button>
          <Button
            variant="destructive"
            disabled={connection.busy || connection.runnerUnavailable}
            onClick={() => void actions.stopRunner()}
          >
            停止后台 Runner
          </Button>
        </div>
        {feedback.error && (
          <p role="alert" className="text-destructive text-sm">
            {feedback.error}
          </p>
        )}
      </SettingsSectionCard>
      {configuration && (
        <SettingsSectionCard title="配置生效状态">
          <InfoRow
            label="数据目录"
            value={<span className="break-all">{configuration.dataDir}</span>}
          />
          <InfoRow
            label="执行状态"
            value={
              connection.runnerStopped
                ? "Runner 已停止"
                : connection.runnerUnavailable
                  ? "连接失败，状态未知"
                  : configuration.ready
                    ? "可执行"
                    : "配置待修复，暂不能执行"
            }
          />
          <p className="text-muted-foreground text-xs leading-5">
            配置来源为 runner.json 和各 Bot 的 bot.json。Bot 默认值在创建时写入；未配置的 Harness
            策略沿用当前库默认值。独立编辑文件后需重载；已有执行使用已保存的配置。
          </p>
          {configuration.restartRequired && (
            <p role="status" className="text-sm">
              部分进程资源配置需要重新启动 Runner 后生效。
            </p>
          )}
          {configuration.errors.map((issue, index) => (
            <p
              role="alert"
              className="text-destructive text-sm break-words"
              key={`${issue.path}:${index}`}
            >
              {issue.path}
              {issue.botId ? `（Bot ${issue.botId}）` : ""}：{issue.message}
            </p>
          ))}
          {configuration.errors.length > 0 && (
            <p className="text-muted-foreground text-xs">
              无效的磁盘修改未生效；已加载的有效配置会保留。请修复后重载。
            </p>
          )}
        </SettingsSectionCard>
      )}
      {configuration && (
        <>
          <Separator />
          <ConfigurationEditor
            files={configuration.files}
            disabled={connection.busy || connection.runnerUnavailable}
          />
        </>
      )}
      <p className="text-muted-foreground text-xs">Node {connection.runtimeVersion || "—"}</p>
    </div>
  );
}
