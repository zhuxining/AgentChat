import { useState } from "react";

import type { ProviderInstance } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { providerError, useProviderOperation } from "@/features/settings/use-providers";

import type { CredentialSource, ProviderAuthentication } from "../../../contracts/providers";

export function CredentialSettings({
  instance,
  saved,
  onChange,
}: {
  instance: ProviderInstance;
  saved: boolean;
  onChange: (auth: ProviderAuthentication) => void;
}) {
  const operation = useProviderOperation();
  const [secret, setSecret] = useState("");
  const [fileMode, setFileMode] = useState("literal");
  const [notice, setNotice] = useState("");
  if (instance.auth.type !== "apiKey") return null;
  const source = instance.auth.source;
  const writable = source.type !== "env";
  function changeSource(type: string) {
    setSecret("");
    setNotice("");
    const source: CredentialSource =
      type === "env"
        ? { type: "env", variable: `${instance.type.replaceAll("-", "_").toUpperCase()}_API_KEY` }
        : type === "file"
          ? { type: "file", path: "credentials/providers.json", entry: instance.id }
          : { type: "keyring", entry: instance.id };
    onChange({ type: "apiKey", source });
  }
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        凭据来源
        <select
          aria-label="凭据来源"
          className="bg-background mt-1 h-9 w-full rounded-md border px-2"
          value={source.type}
          onChange={(event) => changeSource(event.target.value)}
        >
          <option value="keyring">系统凭据库</option>
          <option value="env">环境变量</option>
          <option value="file">独立凭据文件</option>
        </select>
      </label>
      {source.type === "env" ? (
        <>
          <label className="block text-sm">
            环境变量名
            <Input
              aria-label="环境变量名"
              value={source.variable}
              onChange={(event) =>
                onChange({ type: "apiKey", source: { ...source, variable: event.target.value } })
              }
            />
          </label>
          <p className="text-muted-foreground text-xs">
            从后台宿主的环境读取；不会自动改用其他来源。外部环境改变后可能需要从新环境重新启动宿主。
          </p>
        </>
      ) : (
        <>
          {source.type === "file" && (
            <label className="block text-sm">
              凭据文件路径
              <Input
                aria-label="凭据文件路径"
                value={source.path}
                placeholder="credentials/providers.json"
                onChange={(event) =>
                  onChange({ type: "apiKey", source: { ...source, path: event.target.value } })
                }
              />
              <span className="text-muted-foreground text-xs">
                仅允许数据目录 credentials/ 下的文件。
              </span>
            </label>
          )}
          <label className="block text-sm">
            凭据条目
            <Input
              aria-label="凭据条目"
              value={source.entry}
              onChange={(event) =>
                onChange({ type: "apiKey", source: { ...source, entry: event.target.value } })
              }
            />
          </label>
        </>
      )}
      {writable && (
        <>
          {source.type === "file" && (
            <label className="block text-sm">
              文件值格式
              <select
                aria-label="文件值格式"
                className="bg-background mt-1 h-9 w-full rounded-md border px-2"
                value={fileMode}
                onChange={(event) => {
                  setFileMode(event.target.value);
                  setSecret("");
                }}
              >
                <option value="literal">明文密钥</option>
                <option value="env">显式环境变量引用</option>
              </select>
            </label>
          )}
          <label className="block text-sm">
            {fileMode === "env" && source.type === "file" ? "引用的环境变量名" : "新的 API Key"}
            <Input
              aria-label="新的 API Key"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={
                fileMode === "env" && source.type === "file"
                  ? "例如 OPENAI_API_KEY；写入为 ${OPENAI_API_KEY}"
                  : "保存后不回显"
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!saved || operation.isPending || !secret.trim()}
              onClick={() => {
                const value =
                  source.type === "file" && fileMode === "env"
                    ? `\${${secret.trim()}}`
                    : secret.trim();
                operation.mutate(
                  { action: "writeCredential", instanceId: instance.id, value },
                  {
                    onSuccess: () => {
                      setSecret("");
                      setNotice("凭据已保存；重启后台后生效。");
                    },
                  },
                );
              }}
            >
              安全保存凭据
            </Button>
            <Button
              variant="outline"
              disabled={!saved || operation.isPending}
              onClick={() =>
                operation.mutate(
                  { action: "deleteCredential", instanceId: instance.id },
                  {
                    onSuccess: () => {
                      setSecret("");
                      setNotice("凭据已移除。");
                    },
                  },
                )
              }
            >
              移除凭据
            </Button>
          </div>
          {!saved && (
            <p className="text-muted-foreground text-xs">
              请先保存接入与凭据来源，再写入或移除凭据。
            </p>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {operation.error && (
        <p role="alert" className="text-destructive text-sm">
          {providerError(operation.error)}
        </p>
      )}
    </div>
  );
}
