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

export function useProviderOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ProviderRequest) => runnerClient.providerRequest(request),
    onSuccess: async (_result: ProviderResponse, request: ProviderRequest) => {
      if (!["test", "loginStatus", "loginRespond"].includes(request.action)) {
        await queryClient.invalidateQueries({ queryKey: providerQueryKey });
      }
    },
  });
}

export function providerError(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : typeof cause === "string"
      ? cause
      : "供应商操作失败，请重试。";
}
