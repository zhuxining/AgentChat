import { useQueryClient, useQuery } from "@tanstack/react-query";

import { captureRunnerSession, runnerKeys, useRunnerLifecycle } from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useWorkspaceResources } from "@/app/workspace-provider";

export function useBotMemory(botId: string) {
  const { client } = useWorkspaceResources();
  const cache = useQueryClient();
  const lifecycle = useRunnerLifecycle();
  const key = runnerKeys.botMemory(botId);
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const assertCurrent = captureRunnerSession(cache);
      const memory = await client.readBotMemory(botId);
      signal.throwIfAborted();
      assertCurrent();
      return memory;
    },
    enabled: Boolean(botId) && !lifecycle.paused,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const operation = useOperation(["bot-memory", botId]);

  function save(expectedRevision: number, content: string) {
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      const result = await client.saveBotMemory(botId, expectedRevision, content);
      assertCurrent();
      cache.setQueryData(key, result.memory);
      return result;
    });
  }

  return {
    ...query,
    save,
    clearOperationError: operation.clearError,
    busy: operation.busy,
    operationError: operation.error,
    runnerPaused: lifecycle.paused,
  };
}
