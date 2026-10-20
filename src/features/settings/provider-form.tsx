import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ComponentProps } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CredentialSettings } from "@/features/settings/provider-credentials";
import type { ProviderDetail } from "@/features/settings/provider-detail";
import { ProviderModels } from "@/features/settings/provider-models";
import { OAuthSettings } from "@/features/settings/provider-oauth";
import { validateProviderBaseUrl } from "@/features/settings/provider-url";
import {
  providerError,
  providerQueryKey,
  useProviderOperation,
} from "@/features/settings/use-providers";

export function ProviderForm({
  initial,
  saved,
  version,
  models,
  catalog,
  configured,
  statusMessage,
  test,
  onSaved,
  onTest,
}: ComponentProps<typeof ProviderDetail>) {
  const [instance, setInstance] = useState(initial);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const operation = useProviderOperation(false);
  const queryClient = useQueryClient();
  const [currentVersion, setCurrentVersion] = useState(version);
  const [persisted, setPersisted] = useState(saved);
  const [modelId, setModelId] = useState(initial.visibleModels[0] ?? models[0]?.id ?? "");
  const ids = useId();
  const entry = catalog.find((item) => item.type === instance.type);
  const environment = entry?.environment;
  const cloudFields =
    instance.auth.type !== "ambient"
      ? []
      : instance.type === "amazon-bedrock"
        ? ["AWS_REGION", "AWS_PROFILE"]
        : instance.type === "google-vertex"
          ? ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]
          : [];
  const simpleKey = instance.auth.type === "apiKey";
  const environmentAuth =
    instance.auth.type === "apiKey" &&
    (instance.auth.useEnvironment ||
      (instance.auth.source.type === "env" &&
        environment?.variables.includes(instance.auth.source.variable)));
  const dirty = !saved || JSON.stringify(instance) !== JSON.stringify(initial);
  const allowTest = saved && !dirty && models.length > 0;
  async function save() {
    setError("");
    try {
      validateProviderBaseUrl(instance.baseUrl);
      const next =
        secret.trim() && instance.auth.type === "apiKey" && instance.auth.source.type !== "keyring"
          ? {
              ...instance,
              auth: {
                type: "apiKey" as const,
                source: { type: "keyring" as const, entry: instance.id },
                useEnvironment: Boolean(environmentAuth),
              },
            }
          : instance;
      const visibleModels =
        !persisted && !instance.visibleModels.length && models[0]
          ? [models[0].id]
          : instance.visibleModels;
      const result = await operation.mutateAsync({
        action: "save",
        expectedVersion: currentVersion,
        instance: { ...next, visibleModels },
      });
      setCurrentVersion(result.version);
      setPersisted(true);
      setInstance({ ...next, visibleModels });
      if (secret.trim()) {
        const credentialResult = await operation.mutateAsync({
          action: "writeCredential",
          instanceId: instance.id,
          value: secret.trim(),
        });
        setCurrentVersion(credentialResult.version);
      }
      setSecret("");
      onSaved(instance.id);
      await queryClient.invalidateQueries({ queryKey: providerQueryKey });
    } catch (cause) {
      setError(providerError(cause));
    }
  }
  return (
    <div className="space-y-6">
      {simpleKey ? (
        <Field>
          <FieldLabel htmlFor={`${ids}-key`}>API 密钥</FieldLabel>
          <Input
            id={`${ids}-key`}
            aria-label="API 密钥"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={
              configured && instance.auth.type === "apiKey" && instance.auth.source.type !== "env"
                ? "已配置凭证；填写以替换"
                : environmentAuth
                  ? environment?.configured || environment?.detectionError
                    ? "留空使用环境认证"
                    : `留空使用环境认证${environment?.variables.length ? `（${environment.variables.join("、")}）` : ""}`
                  : "填写 API 密钥"
            }
          />
          {environmentAuth && (
            <p
              role="status"
              className={
                environment?.configured || environment?.detected.length
                  ? "text-primary text-sm"
                  : "text-muted-foreground text-sm"
              }
            >
              {environment?.configured
                ? "已检测到供应商环境认证；已保存的密钥优先使用。"
                : environment?.detectionError
                  ? "暂时无法检测环境凭证；您仍可继续配置并保存。"
                  : environment?.detected.length
                    ? `已检测到环境变量（${environment.detected.join("、")}）；已保存的密钥优先使用。`
                    : "未检测到环境凭证，请填写 API 密钥。"}
            </p>
          )}
          {saved &&
            configured &&
            instance.auth.type === "apiKey" &&
            instance.auth.source.type === "keyring" && (
              <Button
                variant="ghost"
                className="w-fit"
                disabled={operation.isPending || dirty}
                onClick={async () => {
                  try {
                    await operation.mutateAsync({
                      action: "deleteCredential",
                      instanceId: instance.id,
                    });
                    setSecret("");
                    await queryClient.invalidateQueries({ queryKey: providerQueryKey });
                  } catch (cause) {
                    setError(providerError(cause));
                  }
                }}
              >
                移除已保存密钥
              </Button>
            )}
        </Field>
      ) : instance.auth.type === "oauth" ? (
        saved && !dirty ? (
          <OAuthSettings instanceId={instance.id} configured={configured} />
        ) : (
          <p className="text-sm">保存后即可登录授权。</p>
        )
      ) : instance.auth.type === "ambient" ? (
        <p className="text-sm">使用供应商的云环境认证。</p>
      ) : (
        <CredentialSettings
          instance={instance}
          saved={saved && !dirty}
          onChange={(auth) => setInstance((previous) => ({ ...previous, auth }))}
        />
      )}
      {statusMessage && (
        <p role="status" className="text-muted-foreground text-sm">
          {statusMessage}
        </p>
      )}
      <Collapsible className="space-y-4 border-t pt-4">
        <CollapsibleTrigger className="focus-visible:ring-ring flex items-center gap-2 rounded text-sm font-medium outline-none focus-visible:ring-2">
          <ChevronDown className="size-4" aria-hidden="true" />
          自定义设置
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4">
          {cloudFields.map((name) => (
            <Field key={name}>
              <FieldLabel htmlFor={`${ids}-${name}`}>{name}</FieldLabel>
              <Input
                id={`${ids}-${name}`}
                aria-label={name}
                value={instance.parameters?.[name] ?? ""}
                placeholder="留空使用云环境配置"
                onChange={(event) =>
                  setInstance((previous) => {
                    const parameters = { ...previous.parameters };
                    if (event.target.value) parameters[name] = event.target.value;
                    else delete parameters[name];
                    return { ...previous, parameters };
                  })
                }
              />
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor={`${ids}-url`}>API 地址</FieldLabel>
            <Input
              id={`${ids}-url`}
              aria-label="API 地址"
              placeholder={
                typeof models[0]?.definition.baseUrl === "string"
                  ? models[0].definition.baseUrl
                  : "使用供应商默认地址"
              }
              value={instance.baseUrl ?? ""}
              onChange={(event) =>
                setInstance((previous) => ({
                  ...previous,
                  baseUrl: event.target.value || undefined,
                }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-name`}>连接名称</FieldLabel>
            <Input
              id={`${ids}-name`}
              aria-label="连接名称"
              value={instance.name}
              onChange={(event) =>
                setInstance((previous) => ({ ...previous, name: event.target.value }))
              }
            />
          </Field>
        </CollapsibleContent>
      </Collapsible>
      <Collapsible className="space-y-3">
        <CollapsibleTrigger className="focus-visible:ring-ring flex items-center gap-2 rounded text-sm outline-none focus-visible:ring-2">
          <ChevronDown className="size-4" aria-hidden="true" />
          其他认证方式
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3">
          <NativeSelect
            aria-label="认证方式"
            value={instance.auth.type}
            onChange={(event) => {
              const type = event.target.value;
              setInstance((previous) => ({
                ...previous,
                auth:
                  type === "ambient"
                    ? { type: "ambient" }
                    : type === "oauth"
                      ? { type: "oauth", source: { type: "keyring", entry: previous.id } }
                      : {
                          type: "apiKey",
                          source: { type: "keyring", entry: previous.id },
                          useEnvironment: true,
                        },
              }));
              setSecret("");
            }}
          >
            {entry?.authentication.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {type === "apiKey" ? "API 密钥" : type === "oauth" ? "OAuth 登录" : "云环境认证"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <CredentialSettings
            instance={instance}
            saved={saved && !dirty}
            onChange={(auth) => {
              setSecret("");
              setInstance((previous) => ({ ...previous, auth }));
            }}
          />
        </CollapsibleContent>
      </Collapsible>
      <section className="space-y-4 border-t pt-5" aria-label="模型目录设置">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">模型目录</h3>
          <Button
            variant="ghost"
            disabled={!saved || dirty || operation.isPending}
            onClick={async () => {
              try {
                await operation.mutateAsync({ action: "refreshModels", instanceId: instance.id });
                await queryClient.invalidateQueries({ queryKey: providerQueryKey });
              } catch (cause) {
                setError(providerError(cause));
              }
            }}
          >
            获取可用模型
          </Button>
        </div>
        <ProviderModels
          instance={instance}
          saved={saved}
          models={models}
          apis={entry?.apis ?? []}
          onChange={setInstance}
        />
      </section>
      {allowTest && (
        <section aria-label="连接测试" className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">测试使用已保存的配置（包括待生效修改），可能产生供应商费用。</p>
          <Field>
            <FieldLabel htmlFor={`${ids}-test-model`}>测试模型</FieldLabel>
            <NativeSelect
              id={`${ids}-test-model`}
              aria-label="测试模型"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <NativeSelectOption value="">选择测试模型</NativeSelectOption>
              {[
                ...new Set([
                  ...models.map((model) => model.id),
                  ...instance.customModels.flatMap((model) =>
                    typeof model.id === "string" ? [model.id] : [],
                  ),
                ]),
              ].map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button
            variant="outline"
            disabled={!modelId || operation.isPending}
            onClick={async () => {
              setError("");
              try {
                const result = await operation.mutateAsync({
                  action: "test",
                  expectedVersion: currentVersion,
                  instanceId: instance.id,
                  modelId,
                });
                if (result.test) onTest(result.test);
              } catch (cause) {
                setError(providerError(cause));
              }
            }}
          >
            测试已保存配置
          </Button>
          {test && (
            <div role="status" className="space-y-1 text-sm">
              <p>
                {test.success
                  ? "连接测试成功"
                  : `连接测试失败${test.category ? `（${test.category}）` : ""}`}
                {test.version !== currentVersion || dirty ? " · 结果已过期" : ""}
              </p>
              <p>{test.message}</p>
              <p className="text-muted-foreground text-xs">
                模型 {test.modelId} · {test.testedAt} · 配置版本 {test.version}
              </p>
            </div>
          )}
        </section>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button disabled={operation.isPending} onClick={() => void save()}>
          保存配置
        </Button>
      </div>
    </div>
  );
}
