import { useMcpServerStatuses } from "@/app/runner-queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/inspector-section";
import { ConfigurationEditor } from "@/features/settings/configuration-editor";
import { SettingsInfoList, SettingsSectionCard } from "@/features/settings/settings-layout";
import { useRunnerSettings } from "@/features/settings/use-runner-actions";

export function RunnerSettings({ active }: { active: boolean }) {
  const { catalog, connection, feedback, actions } = useRunnerSettings();
  const mcpStatuses = useMcpServerStatuses(active);
  const servers = mcpStatuses.data ?? catalog?.mcpServers;
  const configuration = catalog?.configuration;
  return (
    <div className="space-y-6">
      <SettingsSectionCard title="后台运行状态">
        <SettingsInfoList>
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
        </SettingsInfoList>
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
          <Alert variant="destructive">
            <AlertDescription>{feedback.error}</AlertDescription>
          </Alert>
        )}
      </SettingsSectionCard>
      {servers && (
        <SettingsSectionCard title="MCP Server">
          <p className="text-muted-foreground text-xs leading-5">
            在 runner.json 的 mcpServers 中配置本机 stdio Server。发现的工具会出现在 Bot
            能力选择器中；只有 Bot 已选择的能力会执行。
          </p>
          <p className="text-muted-foreground text-xs leading-5">
            配置的命令会在本机以当前用户身份启动，MCP
            进程没有独立沙箱隔离；请只配置可信的命令和参数。
          </p>
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">尚未配置 MCP Server。</p>
          ) : (
            <SettingsInfoList>
              {servers.map((server) => (
                <InfoRow
                  key={server.id}
                  label={server.name}
                  value={
                    <span>
                      {connection.runnerUnavailable || mcpStatuses.isError
                        ? "状态未知"
                        : server.status === "connecting"
                          ? "连接中"
                          : server.status === "connected"
                            ? "已连接 · " + server.toolCount + " 个工具"
                            : "连接失败"}
                      {server.skippedToolCount > 0
                        ? " · 跳过 " + server.skippedToolCount + " 个不支持的工具"
                        : ""}
                    </span>
                  }
                />
              ))}
            </SettingsInfoList>
          )}
          {servers.map(
            (server) =>
              server.message && (
                <p
                  className="text-muted-foreground text-xs break-words"
                  key={server.id + ":message"}
                >
                  {server.name}：{server.message}
                </p>
              ),
          )}
        </SettingsSectionCard>
      )}
      {configuration && (
        <SettingsSectionCard title="配置生效状态">
          <SettingsInfoList>
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
          </SettingsInfoList>
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
            <Alert variant="destructive" key={`${issue.path}:${index}`}>
              <AlertDescription className="break-words">
                {issue.path}
                {issue.botId ? `（Bot ${issue.botId}）` : ""}：{issue.message}
              </AlertDescription>
            </Alert>
          ))}
          {configuration.errors.length > 0 && (
            <p className="text-muted-foreground text-xs">
              无效的磁盘修改未生效；已加载的有效配置会保留。请修复后重载。
            </p>
          )}
        </SettingsSectionCard>
      )}
      {configuration && (
        <SettingsSectionCard title="配置文件">
          <ConfigurationEditor
            files={configuration.files}
            disabled={connection.busy || connection.runnerUnavailable}
          />
        </SettingsSectionCard>
      )}
    </div>
  );
}
