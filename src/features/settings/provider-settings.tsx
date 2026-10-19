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
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { ProviderDetail } from "@/features/settings/provider-detail";
import { SettingsSectionCard } from "@/features/settings/settings-layout";
import { providerError, providerQueryKey, useProviders } from "@/features/settings/use-providers";
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

function newInstance(entry: ProviderCatalogEntry): ProviderInstance {
  const id = `${entry.type}-${crypto.randomUUID().slice(0, 8)}`;
  const auth = entry.authentication[0];
  return {
    id,
    name: entry.name,
    type: entry.type,
    enabled: true,
    auth:
      auth === "oauth"
        ? { type: "oauth", source: { type: "keyring", entry: id } }
        : auth === "ambient"
          ? { type: "ambient" }
          : { type: "apiKey", source: { type: "keyring", entry: id } },
    visibleModels: [],
    modelOverrides: {},
    customModels: [],
  };
}

export function ProviderSettings() {
  const { connection, actions, feedback } = useRunnerSettings();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<ProviderInstance | null>(null);
  const [search, setSearch] = useState("");
  const [tests, setTests] = useState<Record<string, ProviderTestResult>>({});
  const [restart, setRestart] = useState(false);
  const [notice, setNotice] = useState("");
  const query = useProviders(selectedId || undefined, newDraft?.type);
  const data = query.data;
  const status = data?.instances?.find((item) => item.instance.id === selectedId);
  const instance = status?.instance ?? newDraft;
  const needle = search.toLowerCase();

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
      {instance ? (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedId("");
              setNewDraft(null);
              setAdding(false);
              setSearch("");
            }}
          >
            返回接入列表
          </Button>
          <ProviderDetail
            key={`${instance.id}:${data.version}`}
            initial={instance}
            saved={!!status}
            version={data.version}
            models={data.models ?? []}
            catalog={data.catalog ?? []}
            references={data.references ?? []}
            configured={status?.configured ?? false}
            statusMessage={status?.message}
            test={tests[instance.id]}
            onSaved={(id) => {
              setSelectedId(id);
              setNewDraft(null);
              setNotice("接入已保存，重启后台后生效。尚未就绪的凭据请继续配置。");
            }}
            onRemove={() => {
              setSelectedId("");
              setNewDraft(null);
              setNotice("接入已删除，重启后台后生效。");
            }}
            onTest={(test) => setTests((previous) => ({ ...previous, [test.instanceId]: test }))}
          />
        </>
      ) : (
        <SettingsSectionCard title={adding ? "选择内置供应商" : "接入实例"}>
          <div className="flex gap-2">
            <Input
              aria-label={adding ? "搜索内置供应商" : "搜索接入实例"}
              placeholder={adding ? "搜索供应商名称" : "搜索接入名称或供应商类型"}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant={adding ? "outline" : "default"}
              onClick={() => {
                setAdding((value) => !value);
                setSearch("");
              }}
            >
              {adding ? "取消添加" : "添加接入"}
            </Button>
          </div>
          {adding ? (
            <ul aria-label="内置供应商" className="max-h-96 space-y-1 overflow-auto">
              {data.catalog
                ?.filter((entry) => `${entry.type} ${entry.name}`.toLowerCase().includes(needle))
                .map((entry) => (
                  <li key={entry.type}>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-start whitespace-normal"
                      onClick={() => {
                        setNewDraft(newInstance(entry));
                        setAdding(false);
                      }}
                    >
                      {entry.name} · {entry.type} · {entry.modelCount} 个模型
                    </Button>
                  </li>
                ))}
            </ul>
          ) : (
            <ul aria-label="接入实例列表" className="space-y-2">
              {data.instances
                ?.filter(({ instance }) =>
                  `${instance.name} ${instance.type}`.toLowerCase().includes(needle),
                )
                .map(({ instance, status, message }) => (
                  <li key={instance.id}>
                    <Item
                      variant="outline"
                      render={
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(instance.id);
                            setSearch("");
                            setNotice("");
                          }}
                        />
                      }
                      className="hover:bg-muted w-full text-left"
                    >
                      <ItemContent>
                        <ItemTitle>{instance.name}</ItemTitle>
                        <ItemDescription className="text-xs">
                          {instance.type} ·{" "}
                          {
                            {
                              configured: "配置完整",
                              missing: "凭据缺失",
                              disabled: "已停用",
                              error: "配置错误",
                            }[status]
                          }
                        </ItemDescription>
                        <ItemDescription className="text-xs break-all">
                          {addressSummary(instance.baseUrl)}
                        </ItemDescription>
                        {message && (
                          <ItemDescription className="text-foreground text-xs">
                            {message}
                          </ItemDescription>
                        )}
                      </ItemContent>
                    </Item>
                  </li>
                ))}
            </ul>
          )}
          {!adding && !data.instances?.length && (
            <p className="text-muted-foreground text-sm">
              尚未建立接入，添加供应商后选择认证方式与模型。
            </p>
          )}
        </SettingsSectionCard>
      )}
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
