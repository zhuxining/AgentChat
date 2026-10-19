import { useState } from "react";

import type { ProviderInstance } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseObject } from "@/features/settings/model-editor";
import { CredentialSettings } from "@/features/settings/provider-credentials";
import { ProviderModels } from "@/features/settings/provider-models";
import { OAuthSettings } from "@/features/settings/provider-oauth";
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
      if (instance.baseUrl) {
        const url = new URL(instance.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new Error("接入地址必须为 HTTP/HTTPS，不能含用户名或密码。");
      }
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
        <h2 className="min-w-0 flex-1 truncate font-medium">{instance.name || "新接入"}</h2>
        <span className="text-muted-foreground text-xs">
          {configured ? "凭据已配置" : "凭据未就绪"}
        </span>
      </div>
      {statusMessage && (
        <p role="status" className="text-sm">
          {statusMessage}
        </p>
      )}
      <div role="group" aria-label="接入详情分类" className="flex gap-2">
        <Button
          variant={tab === "connection" ? "default" : "outline"}
          aria-pressed={tab === "connection"}
          onClick={() => setTab("connection")}
        >
          连接与认证
        </Button>
        <Button
          variant={tab === "models" ? "default" : "outline"}
          aria-pressed={tab === "models"}
          onClick={() => setTab("models")}
        >
          模型
        </Button>
      </div>
      {tab === "connection" ? (
        <div className="space-y-3">
          <label className="block text-sm">
            接入名称
            <Input
              aria-label="接入名称"
              value={instance.name}
              onChange={(event) =>
                setInstance((previous) => ({ ...previous, name: event.target.value }))
              }
            />
          </label>
          <label className="block text-sm">
            稳定 ID
            <Input
              aria-label="接入稳定 ID"
              disabled={saved}
              value={instance.id}
              onChange={(event) =>
                setInstance((previous) => ({ ...previous, id: event.target.value }))
              }
            />
            <span className="text-muted-foreground text-xs">
              Bot 使用此 ID 引用接入；保存后不可更改。
            </span>
          </label>
          <p className="text-sm">供应商类型：{entry?.name ?? instance.type}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="启用接入"
              checked={instance.enabled}
              onChange={(event) =>
                setInstance((previous) => ({ ...previous, enabled: event.target.checked }))
              }
            />
            启用接入
          </label>
          <p className="text-muted-foreground text-xs">
            停用后需重启生效，不能发起新的模型请求；历史会话仍可查看。
          </p>
          <label className="block text-sm">
            接入地址
            <Input
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
          </label>
          <label className="block text-sm">
            认证方式
            <select
              aria-label="认证方式"
              className="bg-background mt-1 h-9 w-full rounded-md border px-2"
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
                <option value={type} key={type}>
                  {type === "apiKey"
                    ? "API Key"
                    : type === "oauth"
                      ? "OAuth 登录"
                      : "云环境凭据 / 无需密钥"}
                </option>
              ))}
            </select>
          </label>
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
              沿用供应商的云凭据链或本地服务认证行为。可在下方填写
              AWS_REGION、GOOGLE_CLOUD_PROJECT、GOOGLE_CLOUD_LOCATION 等非秘密参数。
            </p>
          )}
          <label className="block text-sm">
            供应商参数 JSON
            <Textarea
              aria-label="供应商参数 JSON"
              className="font-mono text-xs"
              value={parameters}
              onChange={(event) => setParameters(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            连接 Header JSON
            <Textarea
              aria-label="连接 Header JSON"
              className="font-mono text-xs"
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
            />
          </label>
          <p className="text-muted-foreground text-xs">
            参数不填写秘密值；认证 Header 请填写 ${"{credential:entry}"}{" "}
            引用。读取失败会报告原因，不切换其他来源。
          </p>
        </div>
      ) : (
        <ProviderModels
          instance={instance}
          saved={saved}
          models={models}
          apis={entry?.apis ?? []}
          onChange={setInstance}
        />
      )}
      <div className="flex flex-wrap gap-2">
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
      <section aria-label="连接测试" className="space-y-2 rounded-lg border p-3">
        <p className="text-sm">测试使用已保存的配置（包括待生效修改），可能产生供应商费用。</p>
        <label className="block text-sm">
          测试模型
          <select
            aria-label="测试模型"
            className="bg-background mt-1 h-9 w-full rounded-md border px-2"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            <option value="">选择测试模型</option>
            {[
              ...new Set([
                ...models.map((model) => model.id),
                ...instance.customModels.flatMap((model) =>
                  typeof model.id === "string" ? [model.id] : [],
                ),
              ]),
            ].map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
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
      </section>
      {references.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">引用位置（{references.length}）</summary>
          <ul className="text-muted-foreground text-xs">
            {references.map((reference) => (
              <li key={`${reference.kind}:${reference.id}:${reference.modelId}`}>
                {reference.kind} {reference.id} · {reference.modelId}
              </li>
            ))}
          </ul>
        </details>
      )}
      {saved && (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={operation.isPending}
            onClick={() => operation.mutate({ action: "refreshModels", instanceId: instance.id })}
          >
            刷新供应商模型目录
          </Button>
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
        <p role="alert" className="text-destructive text-sm whitespace-pre-wrap">
          {error || providerError(operation.error)}
        </p>
      )}
    </div>
  );
}
