import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";

import type { ProviderInstance } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseObject } from "@/features/settings/model-editor";
import { CredentialSettings } from "@/features/settings/provider-credentials";
import { ProviderModels } from "@/features/settings/provider-models";
import { OAuthSettings } from "@/features/settings/provider-oauth";
import { validateProviderBaseUrl } from "@/features/settings/provider-url";
import { providerError, useProviderOperation } from "@/features/settings/use-providers";

import type {
  ProviderCatalogEntry,
  ProviderModel,
  ProviderReference,
  ProviderTestResult,
} from "../../../contracts/providers";

function stringMap(text: string): Record<string, string> {
  const value = parseObject(text);
  if (!Object.values(value).every((item) => typeof item === "string"))
    throw new Error("参数与 Header 的值必须是字符串。");
  return value as Record<string, string>;
}

export function ProviderDetail({
  initial,
  saved,
  version,
  models,
  catalog,
  references,
  configured,
  statusMessage,
  test,
  onCancel,
  onSaved,
  onRemove,
  onTest,
}: {
  initial: ProviderInstance;
  saved: boolean;
  version: string;
  models: ProviderModel[];
  catalog: ProviderCatalogEntry[];
  references: ProviderReference[];
  configured: boolean;
  statusMessage?: string;
  test?: ProviderTestResult;
  onCancel: () => void;
  onSaved: (instanceId: string) => void;
  onRemove: () => void;
  onTest: (test: ProviderTestResult) => void;
}) {
  const [instance, setInstance] = useState(initial);
  const [tab, setTab] = useState("connection");
  const [parameters, setParameters] = useState(JSON.stringify(initial.parameters ?? {}, null, 2));
  const [headers, setHeaders] = useState(JSON.stringify(initial.headers ?? {}, null, 2));
  const [error, setError] = useState("");
  const [modelId, setModelId] = useState(initial.visibleModels[0] ?? models[0]?.id ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const operation = useProviderOperation();
  const ids = useId();
  const entry = catalog.find((item) => item.type === instance.type);
  const dirty =
    !saved ||
    JSON.stringify(initial) !== JSON.stringify(instance) ||
    JSON.stringify(initial.parameters ?? {}, null, 2) !== parameters ||
    JSON.stringify(initial.headers ?? {}, null, 2) !== headers;

  async function save(andTest: boolean) {
    setError("");
    try {
      if (!instance.name.trim() || !instance.id.trim())
        throw new Error("请填写接入名称与稳定 ID。");
      validateProviderBaseUrl(instance.baseUrl);
      const result = await operation.mutateAsync({
        action: "save",
        expectedVersion: version,
        instance: { ...instance, parameters: stringMap(parameters), headers: stringMap(headers) },
      });
      onSaved(instance.id);
      if (andTest) {
        const response = await operation.mutateAsync({
          action: "test",
          expectedVersion: result.version,
          instanceId: instance.id,
          modelId,
        });
        if (response.test) onTest(response.test);
      }
    } catch (cause) {
      setError(providerError(cause));
    }
  }
  async function runTest() {
    setError("");
    try {
      const result = await operation.mutateAsync({
        action: "test",
        expectedVersion: version,
        instanceId: instance.id,
        modelId,
      });
      if (result.test) onTest(result.test);
    } catch (cause) {
      setError(providerError(cause));
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{instance.name || "新接入"}</h2>
        <span className="text-muted-foreground text-xs">
          {configured ? "凭据已配置" : "凭据未就绪"}
        </span>
      </div>
      {statusMessage && (
        <p role="status" className="text-sm">
          {statusMessage}
        </p>
      )}
      <ToggleGroup
        aria-label="接入详情分类"
        value={[tab]}
        onValueChange={(value) => {
          const next = value[0];
          if (next) setTab(next);
        }}
        variant="outline"
      >
        <ToggleGroupItem value="connection">连接与认证</ToggleGroupItem>
        <ToggleGroupItem value="models">模型</ToggleGroupItem>
      </ToggleGroup>
      {tab === "connection" ? (
        <div className="space-y-3">
          <Field>
            <FieldLabel htmlFor={`${ids}-name`}>接入名称</FieldLabel>
            <Input
              id={`${ids}-name`}
              aria-label="接入名称"
              value={instance.name}
              onChange={(event) =>
                setInstance((previous) => ({ ...previous, name: event.target.value }))
              }
            />
          </Field>
          <Field orientation="horizontal" className="gap-2">
            <Checkbox
              id={`${ids}-enabled`}
              aria-label="启用接入"
              checked={instance.enabled}
              onCheckedChange={(checked) =>
                setInstance((previous) => ({ ...previous, enabled: checked }))
              }
            />
            <FieldLabel htmlFor={`${ids}-enabled`} className="font-normal">
              启用接入
            </FieldLabel>
          </Field>
          <FieldDescription>
            停用后需重启生效，不能发起新的模型请求；历史会话仍可查看。
          </FieldDescription>
          <Field>
            <FieldLabel htmlFor={`${ids}-base-url`}>接入地址</FieldLabel>
            <Input
              id={`${ids}-base-url`}
              aria-label="接入地址"
              type="url"
              placeholder="留空使用供应商默认端点"
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
            <FieldLabel htmlFor={`${ids}-auth`}>认证方式</FieldLabel>
            <NativeSelect
              id={`${ids}-auth`}
              aria-label="认证方式"
              className="w-full"
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
                        : { type: "apiKey", source: { type: "keyring", entry: previous.id } },
                }));
              }}
            >
              {(entry?.authentication ?? [instance.auth.type]).map((type) => (
                <NativeSelectOption value={type} key={type}>
                  {type === "apiKey"
                    ? "API Key"
                    : type === "oauth"
                      ? "OAuth 登录"
                      : "云环境凭据 / 无需密钥"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <CredentialSettings
            key={instance.auth.type}
            instance={instance}
            saved={saved && !dirty}
            onChange={(auth) => setInstance((previous) => ({ ...previous, auth }))}
          />
          {instance.auth.type === "oauth" &&
            (saved && !dirty ? (
              <OAuthSettings instanceId={instance.id} configured={configured} />
            ) : (
              <p className="text-muted-foreground text-sm">保存认证配置后可以登录。</p>
            ))}
          {instance.auth.type === "ambient" && (
            <p className="text-muted-foreground text-sm">
              沿用供应商的云凭据链或本地服务认证行为。
            </p>
          )}
          <Collapsible className="rounded-md border px-3">
            <CollapsibleTrigger className="group/collapsible-trigger focus-visible:ring-ring flex w-full items-center gap-2 py-3 text-left text-sm font-medium outline-none focus-visible:ring-2">
              <ChevronRight
                className="size-4 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
                aria-hidden="true"
              />
              高级接入设置
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3">
              <Field>
                <FieldLabel htmlFor={`${ids}-id`}>稳定 ID</FieldLabel>
                <Input
                  id={`${ids}-id`}
                  aria-label="接入稳定 ID"
                  disabled={saved}
                  value={instance.id}
                  onChange={(event) =>
                    setInstance((previous) => ({ ...previous, id: event.target.value }))
                  }
                />
                <FieldDescription>Bot 使用此 ID 引用接入；保存后不可更改。</FieldDescription>
              </Field>
              <p className="text-sm">供应商类型：{entry?.name ?? instance.type}</p>
              {instance.auth.type === "ambient" && (
                <p className="text-muted-foreground text-sm">
                  可填写 AWS_REGION、GOOGLE_CLOUD_PROJECT、GOOGLE_CLOUD_LOCATION 等非秘密参数。
                </p>
              )}
              <Field>
                <FieldLabel htmlFor={`${ids}-parameters`}>供应商参数 JSON</FieldLabel>
                <Textarea
                  id={`${ids}-parameters`}
                  aria-label="供应商参数 JSON"
                  className="font-mono text-xs"
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${ids}-headers`}>连接 Header JSON</FieldLabel>
                <Textarea
                  id={`${ids}-headers`}
                  aria-label="连接 Header JSON"
                  className="font-mono text-xs"
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                />
                <FieldDescription>
                  参数不填写秘密值；认证 Header 请填写 ${"{credential:entry}"} 引用。
                </FieldDescription>
              </Field>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : (
        <div className="space-y-3">
          {saved && (
            <Button
              variant="outline"
              disabled={operation.isPending || dirty}
              onClick={() => operation.mutate({ action: "refreshModels", instanceId: instance.id })}
            >
              获取可用模型
            </Button>
          )}
          <ProviderModels
            allowBuiltinEditing
            instance={instance}
            saved={saved}
            models={models}
            apis={entry?.apis ?? []}
            onChange={setInstance}
          />
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" disabled={operation.isPending} onClick={onCancel}>
          取消
        </Button>
        <Button disabled={operation.isPending || !dirty} onClick={() => void save(false)}>
          保存接入
        </Button>
        <Button
          variant="outline"
          disabled={operation.isPending || !modelId}
          onClick={() => void save(true)}
        >
          保存并测试
        </Button>
      </div>
      <Collapsible className="rounded-md border px-3">
        <CollapsibleTrigger className="group/collapsible-trigger focus-visible:ring-ring flex w-full items-center gap-2 py-3 text-left text-sm font-medium outline-none focus-visible:ring-2">
          <ChevronRight
            className="size-4 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
            aria-hidden="true"
          />
          连接测试
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pb-3" aria-label="连接测试">
          <p className="text-sm">使用已保存配置测试，可能产生供应商费用。</p>
          <Field>
            <FieldLabel htmlFor={`${ids}-test-model`}>测试模型</FieldLabel>
            <NativeSelect
              id={`${ids}-test-model`}
              aria-label="测试模型"
              className="w-full"
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
            disabled={!saved || dirty || operation.isPending || !modelId}
            onClick={() => void runTest()}
          >
            测试已保存配置
          </Button>
          {test && (
            <div role="status" className="space-y-1 text-sm">
              <p>
                {test.success
                  ? "连接测试成功"
                  : `连接测试失败${test.category ? `（${test.category}）` : ""}`}
                {test.version !== version || dirty ? " · 结果已过期" : ""}
              </p>
              <p>{test.message}</p>
              <p className="text-muted-foreground text-xs">
                模型 {test.modelId} · {test.testedAt} · 配置版本 {test.version}
              </p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
      {references.length > 0 && (
        <Collapsible
          render={<section className="space-y-2" aria-label={`引用位置（${references.length}）`} />}
        >
          <CollapsibleTrigger className="group/collapsible-trigger focus-visible:ring-ring flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2">
            <ChevronRight
              className="size-4 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
              aria-hidden="true"
            />
            引用位置（{references.length}）
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="text-muted-foreground text-xs">
              {references.map((reference) => (
                <li key={`${reference.kind}:${reference.id}:${reference.modelId}`}>
                  {reference.kind} {reference.id} · {reference.modelId}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      {saved && (
        <div className="space-y-2">
          <Button
            variant="destructive"
            disabled={operation.isPending}
            onClick={() => setConfirmRemove(true)}
          >
            删除接入…
          </Button>
          {confirmRemove && (
            <div role="group" aria-label="确认删除接入" className="space-y-2">
              <p className="text-sm">
                确认删除 {instance.name}？被 Bot、会话或默认配置引用时将拒绝删除，可先停用。
              </p>
              <Button
                variant="destructive"
                disabled={operation.isPending}
                onClick={() =>
                  operation.mutate(
                    { action: "remove", instanceId: instance.id, expectedVersion: version },
                    { onSuccess: onRemove },
                  )
                }
              >
                确认删除接入
              </Button>
              <Button variant="outline" onClick={() => setConfirmRemove(false)}>
                取消删除
              </Button>
            </div>
          )}
        </div>
      )}
      {(error || operation.error) && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap">
            {error || providerError(operation.error)}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
