import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

import { runnerClient } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  providerError,
  providerQueryKey,
  useProviderOperation,
} from "@/features/settings/use-providers";

import type { ProviderResponse } from "../../../contracts/providers";

export function OAuthSettings({
  instanceId,
  configured,
}: {
  instanceId: string;
  configured: boolean;
}) {
  const operation = useProviderOperation();
  const queryClient = useQueryClient();
  const [loginId, setLoginId] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["provider-login", loginId],
    queryFn: () => runnerClient.providerRequest({ action: "loginStatus", loginId }),
    enabled: !!loginId,
    retry: false,
    refetchInterval: (query) => (query.state.data?.login?.status === "pending" ? 1000 : false),
  });
  const login = query.data?.login;
  const pending = !!loginId && (!login || login.status === "pending");
  useEffect(() => {
    if (!loginId) return;
    return () => {
      const latest = queryClient.getQueryData<ProviderResponse>(["provider-login", loginId]);
      if (!latest?.login || latest.login.status === "pending") {
        void runnerClient
          .providerRequest({ action: "cancelLogin", loginId })
          .catch(() => undefined);
      }
    };
  }, [loginId, queryClient]);
  useEffect(() => {
    if (login?.status === "success")
      void queryClient.invalidateQueries({ queryKey: providerQueryKey });
  }, [login?.status, queryClient]);

  async function start() {
    setError("");
    try {
      const result = await operation.mutateAsync({ action: "login", instanceId });
      if (!result.login) throw new Error("后台未返回登录流程。");
      queryClient.setQueryData(["provider-login", result.login.id], result);
      setLoginId(result.login.id);
    } catch (cause) {
      setError(providerError(cause));
    }
  }
  async function open() {
    try {
      if (!login?.url) return;
      const url = new URL(login.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new Error("授权地址无效。");
      await openUrl(url.href);
    } catch (cause) {
      setError(providerError(cause));
    }
  }
  return (
    <section aria-label="OAuth 登录" className="space-y-3">
      <p className="text-sm">
        OAuth：{configured ? "已保存登录凭据" : "尚未登录"}；Token 保存在系统凭据库。
      </p>
      <div className="flex gap-2">
        <Button disabled={operation.isPending || pending} onClick={() => void start()}>
          登录授权
        </Button>
        <Button
          variant="outline"
          disabled={operation.isPending || !configured}
          onClick={() => operation.mutate({ action: "logout", instanceId })}
        >
          退出登录
        </Button>
      </div>
      {login && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            登录状态：
            {
              { pending: "等待授权", success: "登录成功", cancelled: "已取消", error: "登录失败" }[
                login.status
              ]
            }
          </p>
          {login.instructions && <p>{login.instructions}</p>}
          {login.progress && <p>{login.progress}</p>}
          {login.url && (
            <Button variant="outline" onClick={() => void open()}>
              在系统浏览器打开授权页面
            </Button>
          )}
          {login.error && <p role="alert">{login.error}</p>}
          {pending && login.prompt && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                operation.mutate(
                  { action: "loginRespond", loginId, value: response },
                  {
                    onSuccess: () => {
                      setResponse("");
                      void query.refetch();
                    },
                  },
                );
              }}
            >
              <label className="block">
                {login.prompt.message}
                {login.prompt.type === "select" ? (
                  <select
                    aria-label="OAuth 授权响应"
                    className="bg-background h-9 w-full rounded-md border px-2"
                    value={response}
                    onChange={(event) => setResponse(event.target.value)}
                  >
                    <option value="">请选择</option>
                    {login.prompt.options?.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.description ? ` · ${option.description}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    aria-label="OAuth 授权响应"
                    type={login.prompt.type === "text" ? "text" : "password"}
                    autoComplete="off"
                    placeholder={login.prompt.placeholder}
                    value={response}
                    onChange={(event) => setResponse(event.target.value)}
                  />
                )}
              </label>
              <Button
                type="submit"
                disabled={operation.isPending || (!response && !login.prompt.allowEmpty)}
              >
                提交授权响应
              </Button>
            </form>
          )}
        </div>
      )}
      {pending && (
        <Button
          variant="outline"
          disabled={operation.isPending}
          onClick={() =>
            operation.mutate(
              { action: "cancelLogin", loginId },
              {
                onSuccess: () => {
                  setResponse("");
                  void query.refetch();
                },
              },
            )
          }
        >
          取消登录
        </Button>
      )}
      {(error || operation.error || query.error) && (
        <p role="alert" className="text-destructive text-sm">
          {error || providerError(operation.error ?? query.error)}
        </p>
      )}
    </section>
  );
}
