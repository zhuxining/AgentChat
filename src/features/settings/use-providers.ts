import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runnerClient } from "@/app/runner-client";

import type { ProviderRequest, ProviderResponse } from "../../../contracts/providers";

export const providerQueryKey = ["provider-settings"] as const;

export function useProviders(instanceId?: string, type?: string, search?: string) {
  return useQuery({
    queryKey: [...providerQueryKey, instanceId ?? "", type ?? "", search ?? ""],
    queryFn: () => runnerClient.providerRequest({ action: "list", instanceId, type, search }),
    retry: false,
  });
}

export function useProviderOperation(invalidate = true) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ProviderRequest) => runnerClient.providerRequest(request),
    onSuccess: async (_result: ProviderResponse, request: ProviderRequest) => {
      if (invalidate && !["test", "loginStatus", "loginRespond"].includes(request.action)) {
        await queryClient.invalidateQueries({ queryKey: providerQueryKey });
      }
    },
  });
}

// Runner 错误文案直接透传；IPC/传输层的通用失败统一映射为可行动的中文提示，
// 页面不再各自拼 catch 逻辑。
const GENERIC_PROVIDER_ERROR = "供应商操作失败，请重试。";

const transportErrorMap: Array<[pattern: RegExp, message: string]> = [
  [/runner.*(unavailable|not running|未运行|不可用)/i, "Runner 未运行，请先启动或重连。"],
  [/timed? ?out|超时/i, "操作超时，请检查 Runner 状态后重试。"],
];

export function providerError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  if (!raw) return GENERIC_PROVIDER_ERROR;
  for (const [pattern, message] of transportErrorMap) {
    if (pattern.test(raw)) return message;
  }
  return raw;
}
