import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { ProviderInstance } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProviderDetail } from "@/features/settings/provider-detail";
import { ProviderForm } from "@/features/settings/provider-form";
import { SettingsSectionCard } from "@/features/settings/settings-layout";
import {
  providerError,
  providerQueryKey,
  useProviderOperation,
  useProviders,
} from "@/features/settings/use-providers";
import { useRunnerSettings } from "@/features/settings/use-runner-actions";

import type { ProviderCatalogEntry, ProviderTestResult } from "../../../contracts/providers";

export function addressSummary(address?: string) {
  if (!address) return "供应商默认地址";
  try {
    const url = new URL(address);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "地址无效";
  }
}

function newInstance(entry: ProviderCatalogEntry, custom = false): ProviderInstance {
  const id = `${entry.type}-${crypto.randomUUID().slice(0, 8)}`;
  const auth = entry.authentication[0];
  return {
    id,
    name: entry.name,
    type: entry.type,
    enabled: true,
    ...(custom ? { custom: true } : {}),
    auth:
      auth === "oauth"
        ? { type: "oauth", source: { type: "keyring", entry: id } }
        : auth === "ambient"
          ? { type: "ambient" }
          : { type: "apiKey", source: { type: "keyring", entry: id }, useEnvironment: true },
    visibleModels: [],
    modelOverrides: {},
    customModels: [],
  };
}

export function ProviderSettings() {
  const { connection, actions, feedback } = useRunnerSettings();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState("builtin");
  const [newDraft, setNewDraft] = useState<ProviderInstance | null>(null);
  const [tests, setTests] = useState<Record<string, ProviderTestResult>>({});
  const [restart, setRestart] = useState(false);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<ProviderInstance | null>(null);
  const [removeError, setRemoveError] = useState("");
  const operation = useProviderOperation();
  const query = useProviders();
  const data = query.data;
  const connections =
    data?.instances?.filter((item) => Boolean(item.instance.custom) === (mode === "custom")) ?? [];
  const status = data?.instances?.find((item) => item.instance.id === selectedId);
  const instance = status?.instance ?? newDraft;
  const detailQuery = useProviders(
    instance?.id && status ? instance.id : undefined,
    instance?.type,
  );
  const Detail = mode === "custom" ? ProviderDetail : ProviderForm;

  if (query.isPending)
    return (
      <p role="status" className="text-sm">
        正在读取供应商配置…
      </p>
    );
  if (query.error || !data)
    return (
      <SettingsSectionCard title="模型供应商">
        <Alert variant="destructive">
          <AlertDescription>{providerError(query.error)}</AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-xs">如果后台版本较旧，请重新启动后台后重试。</p>
        <Button onClick={() => void query.refetch()}>重新读取供应商</Button>
      </SettingsSectionCard>
    );
  return (
    <div className="space-y-5">
      {data.restartRequired && (
        <section role="status" className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">供应商配置已保存，重新启动后台后生效。</p>
          <p className="text-muted-foreground text-xs">
            重启子进程会继承宿主当前环境；如宿主环境过旧，请从新环境重新启动宿主。
          </p>
          <Button variant="outline" disabled={connection.busy} onClick={() => setRestart(true)}>
            重启后台并应用
          </Button>
        </section>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <section aria-label="已连接供应商" className="space-y-3">
        <h2 className="text-sm font-semibold">模型</h2>
        <ul aria-label="已连接供应商" className="space-y-3">
          {data.instances?.map(({ instance: connection, status: connectionStatus }) => (
            <li key={connection.id}>
              <Item variant="outline" className="flex-nowrap rounded-xl p-3">
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    {connection.name}
                    {connection.custom && (
                      <span className="text-muted-foreground rounded border px-1.5 text-xs font-normal">
                        自定义
                      </span>
                    )}
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-normal">
                      <span
                        aria-hidden="true"
                        className={
                          connectionStatus === "configured"
                            ? "bg-primary size-2 rounded-full"
                            : "bg-muted-foreground size-2 rounded-full"
                        }
                      />
                      {
                        {
                          configured: connection.auth.type === "oauth" ? "已登录" : "已配置",
                          missing: "待配置凭据",
                          disabled: "已停用",
                          error: "配置异常",
                        }[connectionStatus]
                      }
                    </span>
                  </ItemTitle>
                  <ItemDescription className="text-xs break-all">
                    {addressSummary(connection.baseUrl)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`编辑 ${connection.name}`}
                    aria-expanded={editorOpen && selectedId === connection.id}
                    onClick={() => {
                      setMode(connection.custom ? "custom" : "builtin");
                      setSelectedId(connection.id);
                      setNewDraft(null);
                      setNotice("");
                      setEditorOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  {connection.custom && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      aria-label={`删除 ${connection.name}`}
                      onClick={() => {
                        setRemoving(connection);
                        setRemoveError("");
                      }}
                    >
                      删除
                    </Button>
                  )}
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
        {!data.instances?.length && (
          <p className="text-muted-foreground text-sm">尚未添加模型提供商。</p>
        )}
        <Button
          variant="outline"
          className="h-10 w-full border-dashed"
          onClick={() => {
            setSelectedId("");
            setNewDraft(null);
            setMode("builtin");
            setNotice("");
            setEditorOpen(true);
          }}
        >
          ＋ 添加模型提供商
        </Button>
      </section>
      {editorOpen && (
        <section aria-label="模型提供商配置" className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">
            {instance
              ? status
                ? `编辑 ${instance.name}`
                : `配置 ${instance.name}`
              : "添加模型提供商"}
          </h2>
          <ToggleGroup
            aria-label="供应商配置类型"
            value={[mode]}
            onValueChange={(value) => {
              if (value[0] && value[0] !== mode) {
                setMode(value[0]);
                setSelectedId("");
                setNewDraft(null);
                setNotice("");
              }
            }}
            variant="outline"
          >
            <ToggleGroupItem value="builtin">第三方模型提供商</ToggleGroupItem>
            <ToggleGroupItem value="custom">自定义模型 API</ToggleGroupItem>
          </ToggleGroup>
          <div className="space-y-2">
            <label htmlFor="provider-type" className="text-sm font-medium">
              提供商
            </label>
            <NativeSelect
              id="provider-type"
              aria-label="提供商"
              value={instance?.type ?? ""}
              onChange={(event) => {
                const entry = data.catalog?.find((item) => item.type === event.target.value);
                if (!entry) return;
                const existing = selectedId
                  ? connections.find((item) => item.instance.type === entry.type)
                  : undefined;
                setSelectedId(existing?.instance.id ?? "");
                setNewDraft(existing ? null : newInstance(entry, mode === "custom"));
                setNotice("");
              }}
            >
              <NativeSelectOption value="" disabled>
                选择提供商
              </NativeSelectOption>
              {data.catalog?.map((entry) => (
                <NativeSelectOption key={entry.type} value={entry.type}>
                  {entry.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {instance && (
            <div className="space-y-2">
              {connections.filter((item) => item.instance.type === instance.type).length > 1 && (
                <NativeSelect
                  aria-label="选择连接"
                  value={instance.id}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setNewDraft(null);
                  }}
                >
                  {connections
                    .filter((item) => item.instance.type === instance.type)
                    .map((item) => (
                      <NativeSelectOption key={item.instance.id} value={item.instance.id}>
                        {item.instance.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              )}
              {mode === "custom" && status && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const entry = data.catalog?.find((item) => item.type === instance.type);
                    if (entry) {
                      setSelectedId("");
                      setNewDraft(newInstance(entry, true));
                    }
                  }}
                >
                  添加其他账号或连接
                </Button>
              )}
            </div>
          )}
          {instance && detailQuery.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取模型目录…
            </p>
          ) : instance && detailQuery.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {providerError(detailQuery.error)}
                <Button variant="ghost" onClick={() => void detailQuery.refetch()}>
                  重新读取模型目录
                </Button>
              </AlertDescription>
            </Alert>
          ) : instance ? (
            <Detail
              key={`${instance.id}:${data.version}`}
              initial={instance}
              saved={!!status}
              version={data.version}
              models={detailQuery.data?.models ?? []}
              catalog={detailQuery.data?.catalog ?? data.catalog ?? []}
              references={detailQuery.data?.references ?? []}
              configured={status?.configured ?? false}
              statusMessage={status?.message}
              test={tests[instance.id]}
              onCancel={() => {
                setEditorOpen(false);
                setSelectedId("");
                setNewDraft(null);
              }}
              onSaved={(id) => {
                setSelectedId(id);
                setNewDraft(null);
                setNotice("配置已保存，重启后台后生效。");
              }}
              onRemove={() => {
                setSelectedId("");
                setNewDraft(null);
                setNotice("接入已删除，重启后台后生效。");
                setEditorOpen(false);
              }}
              onTest={(test) => setTests((previous) => ({ ...previous, [test.instanceId]: test }))}
            />
          ) : (
            <p role="status" className="text-muted-foreground text-sm">
              尚未选择提供商。
            </p>
          )}
          {!instance && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setEditorOpen(false);
                  setSelectedId("");
                  setNewDraft(null);
                }}
              >
                取消
              </Button>
            </div>
          )}
        </section>
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型提供商</DialogTitle>
            <DialogDescription>
              确定删除“{removing?.name}”？被 Bot 或会话引用的连接无法删除。
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <Alert variant="destructive">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={operation.isPending}
              onClick={async () => {
                if (!removing) return;
                try {
                  await operation.mutateAsync({
                    action: "remove",
                    expectedVersion: data.version,
                    instanceId: removing.id,
                  });
                  setRemoving(null);
                  setNotice("连接已删除，重启后台后生效。");
                  if (selectedId === removing.id) {
                    setEditorOpen(false);
                    setSelectedId("");
                    setNewDraft(null);
                  }
                } catch (cause) {
                  setRemoveError(providerError(cause));
                }
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={restart} onOpenChange={setRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新启动后台</DialogTitle>
            <DialogDescription>
              其他 Bot
              可能仍有任务，重启可能中断正在执行的工作。未完成工作将保留恢复状态，请确认重启时机。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestart(false)}>
              暂不重启
            </Button>
            <Button
              disabled={connection.busy}
              onClick={async () => {
                if (await actions.restartRunner()) {
                  setRestart(false);
                  setNotice("后台已重新连接。");
                  await queryClient.invalidateQueries({ queryKey: providerQueryKey });
                }
              }}
            >
              确认重新启动
            </Button>
          </DialogFooter>
          {feedback.error && (
            <Alert variant="destructive">
              <AlertDescription>{feedback.error}</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
