import { useState } from "react";

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
import { InfoRow } from "@/features/chat/inspector-section";
import type { Workspace } from "@/features/chat/use-workspace";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: Pick<
    Workspace["connection"],
    "busy" | "providerConfigured" | "runtimeVersion" | "runnerUnavailable" | "credentialWarning"
  >;
  feedback: Pick<Workspace["feedback"], "error" | "notice">;
  actions: Pick<Workspace["actions"], "setProviderCredential" | "restartRunner">;
};

export function SettingsDialog({
  open,
  onOpenChange,
  connection: { busy, providerConfigured, runtimeVersion, runnerUnavailable, credentialWarning },
  feedback: { error, notice },
  actions: { setProviderCredential, restartRunner },
}: Props) {
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>DeepSeek 凭据与本机运行状态。</DialogDescription>
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
        <InfoRow label="本机状态" value={runnerUnavailable ? "连接失败" : "已连接"} />
        <Button variant="outline" disabled={busy} onClick={() => void restartRunner()}>
          重新连接
        </Button>
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
