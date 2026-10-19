import { useId, useState } from "react";

import type { ProviderInstance } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  const ids = useId();
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
      <Field>
        <FieldLabel htmlFor={`${ids}-source`}>凭据来源</FieldLabel>
        <NativeSelect
          id={`${ids}-source`}
          aria-label="凭据来源"
          className="w-full"
          value={source.type}
          onChange={(event) => changeSource(event.target.value)}
        >
          <NativeSelectOption value="keyring">系统凭据库</NativeSelectOption>
          <NativeSelectOption value="env">环境变量</NativeSelectOption>
          <NativeSelectOption value="file">独立凭据文件</NativeSelectOption>
        </NativeSelect>
      </Field>
      {source.type === "env" ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${ids}-variable`}>环境变量名</FieldLabel>
            <Input
              id={`${ids}-variable`}
              aria-label="环境变量名"
              value={source.variable}
              onChange={(event) =>
                onChange({ type: "apiKey", source: { ...source, variable: event.target.value } })
              }
            />
            <FieldDescription>
              从后台宿主的环境读取；不会自动改用其他来源。外部环境改变后可能需要从新环境重新启动宿主。
            </FieldDescription>
          </Field>
        </>
      ) : (
        <>
          {source.type === "file" && (
            <Field>
              <FieldLabel htmlFor={`${ids}-path`}>凭据文件路径</FieldLabel>
              <Input
                id={`${ids}-path`}
                aria-label="凭据文件路径"
                value={source.path}
                placeholder="credentials/providers.json"
                onChange={(event) =>
                  onChange({ type: "apiKey", source: { ...source, path: event.target.value } })
                }
              />
              <FieldDescription>仅允许数据目录 credentials/ 下的文件。</FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor={`${ids}-entry`}>凭据条目</FieldLabel>
            <Input
              id={`${ids}-entry`}
              aria-label="凭据条目"
              value={source.entry}
              onChange={(event) =>
                onChange({ type: "apiKey", source: { ...source, entry: event.target.value } })
              }
            />
          </Field>
        </>
      )}
      {writable && (
        <>
          {source.type === "file" && (
            <Field>
              <FieldLabel htmlFor={`${ids}-file-mode`}>文件值格式</FieldLabel>
              <NativeSelect
                id={`${ids}-file-mode`}
                aria-label="文件值格式"
                className="w-full"
                value={fileMode}
                onChange={(event) => {
                  setFileMode(event.target.value);
                  setSecret("");
                }}
              >
                <NativeSelectOption value="literal">明文密钥</NativeSelectOption>
                <NativeSelectOption value="env">显式环境变量引用</NativeSelectOption>
              </NativeSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor={`${ids}-secret`}>
              {fileMode === "env" && source.type === "file" ? "引用的环境变量名" : "新的 API Key"}
            </FieldLabel>
            <Input
              id={`${ids}-secret`}
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
          </Field>
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
            <FieldDescription>请先保存接入与凭据来源，再写入或移除凭据。</FieldDescription>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {operation.error && (
        <Alert variant="destructive">
          <AlertDescription>{providerError(operation.error)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
