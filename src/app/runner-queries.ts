import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type {
  BotListSummary,
  ConversationSnapshot,
  InitializeResult,
  runnerClient,
} from "@/app/runner-client";
import { useWorkspaceResources } from "@/app/workspace-provider";

export const runnerKeys = {
  all: ["runner"] as const,
  catalog: ["runner", "catalog"] as const,
  mcpStatuses: ["runner", "mcp-statuses"] as const,
  lifecycle: ["runner", "lifecycle"] as const,
  snapshots: ["runner", "snapshot"] as const,
  snapshot: (id: number | null) => ["runner", "snapshot", id] as const,
  botMemory: (botId: string) => ["runner", "bot-memory", botId] as const,
  botSummaries: ["runner", "bot-summaries"] as const,
  botSummariesFor: (botIds: string[], conversationIds: (number | null)[]) =>
    ["runner", "bot-summaries", botIds, conversationIds] as const,
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
    if (current.paused || current.stopped || current.failed || current.generation !== generation)
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

export function useMcpServerStatuses(enabled: boolean) {
  const { client } = useWorkspaceResources();
  const lifecycle = useRunnerLifecycle();
  const active = enabled && !lifecycle.paused;
  return useQuery({
    queryKey: runnerKeys.mcpStatuses,
    queryFn: async ({ signal }) => {
      const statuses = await client.mcpStatuses();
      signal.throwIfAborted();
      return statuses;
    },
    enabled: active,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: active ? 3_000 : false,
  });
}

export function updateMcpServerStatuses(cache: QueryClient, initial: InitializeResult) {
  if (initial.mcpServers) cache.setQueryData(runnerKeys.mcpStatuses, initial.mcpServers);
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

export function botSummariesOptions(
  client: typeof runnerClient,
  cache: QueryClient,
  targets: { botId: string; conversationId: number | null }[],
  supportsBatch: boolean,
) {
  return queryOptions({
    queryKey: runnerKeys.botSummariesFor(
      targets.map((target) => target.botId),
      targets.map((target) => target.conversationId),
    ),
    queryFn: async ({ signal }) => {
      if (supportsBatch) {
        try {
          const summaries = await client.botSummaries();
          signal.throwIfAborted();
          return summaries;
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
          if (!message.includes("不支持的 Runner 操作")) throw cause;
        }
      }
      const summaries: BotListSummary[] = await Promise.all(
        targets.map(async ({ botId, conversationId }) => {
          if (conversationId === null)
            return { botId, conversationId: null, latestMessage: "", executing: false };
          const snapshot = await cache.ensureQueryData<ConversationSnapshot>({
            queryKey: runnerKeys.snapshot(conversationId),
            queryFn: () => client.snapshot(conversationId),
          });
          return {
            botId,
            conversationId,
            latestMessage: snapshot.messages.filter((message) => message.text).at(-1)?.text ?? "",
            executing: snapshot.activeTasks.some((task) => task.status === "running"),
          };
        }),
      );
      signal.throwIfAborted();
      return summaries;
    },
    staleTime: 1_200,
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
