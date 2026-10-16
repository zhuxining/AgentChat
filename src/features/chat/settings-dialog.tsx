import { useState } from "react";

import type { ConfigurationStatus } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConfigurationEditor } from "@/features/chat/configuration-editor";
import { InfoRow } from "@/features/chat/inspector-section";
import type { Workspace } from "@/features/chat/use-workspace";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configuration: ConfigurationStatus | null;
  connection: Pick<
    Workspace["connection"],
    | "busy"
    | "providerConfigured"
    | "runtimeVersion"
    | "runnerUnavailable"
    | "runnerStopped"
    | "credentialWarning"
  >;
  feedback: Pick<Workspace["feedback"], "error" | "notice">;
  actions: Pick<
    Workspace["actions"],
    | "setProviderCredential"
    | "restartRunner"
    | "stopRunner"
    | "reloadConfiguration"
    | "readConfiguration"
    | "saveConfiguration"
  >;
};

export function SettingsDialog({
  open,
  onOpenChange,
  connection: {
    busy,
    providerConfigured,
    runtimeVersion,
    runnerUnavailable,
    runnerStopped,
    credentialWarning,
  },
  configuration,
  feedback: { error, notice },
  actions,
}: Props) {
  const { setProviderCredential, restartRunner, stopRunner, reloadConfiguration } = actions;
  const [providerKey, setProviderKey] = useState("");
  async function onSetProviderCredential(key: string | null) {
    if (await setProviderCredential(key)) setProviderKey("");
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setProviderKey("");
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>本机 Runner 配置、后台运行状态与安全凭据。</DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {providerConfigured ? "DeepSeek 密钥已配置" : "未检测到 DEEPSEEK_API_KEY"}
        </p>
        <Input
          aria-label="DeepSeek API Key"
          type="password"
          autoComplete="off"
          placeholder="输入新的 DeepSeek API Key"
          value={providerKey}
          onChange={(event) => setProviderKey(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            disabled={busy || !providerKey.trim()}
            onClick={() => void onSetProviderCredential(providerKey.trim())}
          >
            安全保存
          </Button>
          <Button
            variant="outline"
            disabled={busy || !providerConfigured}
            onClick={() => void onSetProviderCredential(null)}
          >
            移除已保存密钥
          </Button>
        </div>
        <p className="text-muted-foreground text-xs leading-5">
          密钥保存在系统凭据库。未保存时从宿主环境变量 DEEPSEEK_API_KEY 读取。
        </p>
        <Separator />
        <InfoRow
          label="本机状态"
          value={runnerStopped ? "后台已停止" : runnerUnavailable ? "连接失败" : "已连接"}
        />
        <p className="text-muted-foreground text-xs leading-5">
          关闭窗口或退出 UI 后，后台 Runner 继续运行。停止 Runner
          会保留未完成工作的恢复状态；取消工作需单独操作。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void restartRunner()}>
            {runnerStopped ? "启动并连接" : "重新启动并连接"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || runnerUnavailable}
            onClick={() => void reloadConfiguration()}
          >
            重载配置
          </Button>
          <Button
            variant="destructive"
            disabled={busy || runnerUnavailable}
            onClick={() => void stopRunner()}
          >
            停止后台 Runner
          </Button>
        </div>
        {configuration && (
          <section aria-label="配置生效状态" className="space-y-2 text-sm">
            <InfoRow
              label="数据目录"
              value={<span className="break-all">{configuration.dataDir}</span>}
            />
            <InfoRow
              label="执行状态"
              value={
                runnerStopped
                  ? "Runner 已停止"
                  : runnerUnavailable
                    ? "连接失败，状态未知"
                    : configuration.ready
                      ? "可执行"
                      : "配置待修复，暂不能执行"
              }
            />
            <p className="text-muted-foreground text-xs leading-5">
              配置来源为 runner.json 和各 Bot 的 bot.json。Bot 默认值在创建时写入；未配置的 Harness
              策略沿用当前库默认值。 独立编辑文件后需重载；已有执行使用已保存的配置。
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
                {issue.botId ? `（智能体 ${issue.botId}）` : ""}：{issue.message}
              </p>
            ))}
            {configuration.errors.length > 0 && (
              <p className="text-muted-foreground text-xs">
                无效的磁盘修改未生效；已加载的有效配置会保留。请修复后重载。
              </p>
            )}
          </section>
        )}
        <Separator />
        {open && configuration && (
          <ConfigurationEditor
            files={configuration.files}
            disabled={busy || runnerUnavailable}
            actions={actions}
          />
        )}
        <p className="text-muted-foreground text-xs">Node {runtimeVersion || "—"}</p>
        {(error || credentialWarning) && (
          <p role="alert" className="text-destructive text-sm">
            {error || credentialWarning}
          </p>
        )}
        {notice && (
          <p role="status" className="text-muted-foreground text-sm">
            {notice}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
