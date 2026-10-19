import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoRow } from "@/components/ui/inspector-section";
import { Separator } from "@/components/ui/separator";
import { SettingsSectionCard } from "@/features/settings/settings-layout";
import { useRunnerSettings } from "@/features/settings/use-runner-actions";

export function ProviderSettings() {
  const { connection, feedback, actions } = useRunnerSettings();
  const [providerKey, setProviderKey] = useState("");
  async function onSetProviderCredential(key: string | null) {
    if (await actions.setProviderCredential(key)) setProviderKey("");
  }
  return (
    <SettingsSectionCard title="DeepSeek">
      <p className="text-sm">
        {connection.providerConfigured ? "DeepSeek 密钥已配置" : "未检测到 DEEPSEEK_API_KEY"}
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
          disabled={connection.busy || !providerKey.trim()}
          onClick={() => void onSetProviderCredential(providerKey.trim())}
        >
          安全保存
        </Button>
        <Button
          variant="outline"
          disabled={connection.busy || !connection.providerConfigured}
          onClick={() => void onSetProviderCredential(null)}
        >
          移除已保存密钥
        </Button>
      </div>
      <p className="text-muted-foreground text-xs leading-5">
        密钥保存在系统凭据库。未保存时从宿主环境变量 DEEPSEEK_API_KEY 读取。
      </p>
      <Separator />
      <InfoRow label="凭据状态" value={connection.providerConfigured ? "已配置" : "未配置"} />
      {connection.credentialWarning && (
        <p role="alert" className="text-destructive text-sm">
          {connection.credentialWarning}
        </p>
      )}
      {feedback.error && (
        <p role="alert" className="text-destructive text-sm">
          {feedback.error}
        </p>
      )}
    </SettingsSectionCard>
  );
}
