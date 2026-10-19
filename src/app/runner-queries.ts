import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { InitializeResult, runnerClient } from "@/app/runner-client";
import { useWorkspaceResources } from "@/app/workspace-provider";

export const runnerKeys = {
  all: ["runner"] as const,
  catalog: ["runner", "catalog"] as const,
  lifecycle: ["runner", "lifecycle"] as const,
  snapshots: ["runner", "snapshot"] as const,
  snapshot: (id: number | null) => ["runner", "snapshot", id] as const,
};
export type RunnerLifecycle = {
  paused: boolean;
  stopped: boolean;
  failed: boolean;
  generation: number;
};
const initialLifecycle: RunnerLifecycle = {
  paused: false,
  stopped: false,
  failed: false,
  generation: 0,
};

// IPC cannot be physically cancelled. Every workflow checks its Runner generation before
// applying a result or starting another request, including mutation follow-up reads.
export function captureRunnerSession(cache: QueryClient) {
  const generation = cache.getQueryData<RunnerLifecycle>(runnerKeys.lifecycle)?.generation ?? 0;
  function assertCurrent() {
    const current = cache.getQueryData<RunnerLifecycle>(runnerKeys.lifecycle) ?? initialLifecycle;
    if (current.paused || current.generation !== generation)
      throw new Error("Runner 已停止或重新启动，请重新读取后重试。");
  }
  assertCurrent();
  return assertCurrent;
}

export function useRunnerLifecycle() {
  return useQuery({
    queryKey: runnerKeys.lifecycle,
    queryFn: () => initialLifecycle,
    initialData: initialLifecycle,
    enabled: false,
    staleTime: Infinity,
  }).data;
}

export function useRunnerCatalog() {
  const { client } = useWorkspaceResources();
  const lifecycle = useRunnerLifecycle();
  return useQuery({
    queryKey: runnerKeys.catalog,
    queryFn: async ({ signal }) => {
      const initial = await client.initialize();
      signal.throwIfAborted();
      return initial;
    },
    enabled: !lifecycle.paused,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function snapshotOptions(client: typeof runnerClient, id: number | null) {
  return queryOptions({
    queryKey: runnerKeys.snapshot(id),
    queryFn: async ({ signal }) => {
      if (id === null) throw new Error("缺少 Conversation");
      const snapshot = await client.snapshot(id);
      signal.throwIfAborted();
      return snapshot;
    },
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useConversationSnapshot(id: number | null, live = false) {
  const { client } = useWorkspaceResources();
  const lifecycle = useRunnerLifecycle();
  return useQuery({
    ...snapshotOptions(client, id),
    enabled: id !== null && !lifecycle.paused,
    refetchInterval: live && !lifecycle.paused ? 1_200 : false,
  });
}

export function useCatalogCache() {
  const cache = useQueryClient();
  return (update: (current: InitializeResult) => InitializeResult) => {
    cache.setQueryData<InitializeResult>(runnerKeys.catalog, (current) =>
      current ? update(current) : current,
    );
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "操作失败，请重试";
}
