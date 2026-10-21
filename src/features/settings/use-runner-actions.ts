import { useQueryClient } from "@tanstack/react-query";

import {
  captureRunnerSession,
  runnerKeys,
  updateMcpServerStatuses,
  useRunnerCatalog,
  useRunnerLifecycle,
  type RunnerLifecycle,
} from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useWorkspaceResources } from "@/app/workspace-provider";

export function useRunnerActions() {
  const { client, drafts } = useWorkspaceResources();
  const cache = useQueryClient();
  const operation = useOperation(["runner-controls"]);
  const lifecycle = useRunnerLifecycle();
  function setLifecycle(value: Partial<RunnerLifecycle>) {
    cache.setQueryData<RunnerLifecycle>(runnerKeys.lifecycle, (current) => ({
      ...lifecycle,
      ...current,
      ...value,
    }));
  }
  async function pause() {
    cache.setQueryData<RunnerLifecycle>(runnerKeys.lifecycle, (current) => ({
      ...(current ?? lifecycle),
      paused: true,
      generation: (current?.generation ?? lifecycle.generation) + 1,
    }));
    const draftState = drafts.getState();
    const pendingAttachmentIds = new Set(
      draftState.pendingSubmission?.attachments.map(({ id }) => id) ?? [],
    );
    const attachmentsByConversation: Record<
      number,
      (typeof draftState.attachmentsByConversation)[number]
    > = {};
    const staleAttachmentsByConversation = new Map<number, string[]>();
    const errors = { ...draftState.errors };
    for (const [key, attachments] of Object.entries(draftState.attachmentsByConversation)) {
      const conversationId = Number(key);
      const pending = attachments.filter(({ id }) => pendingAttachmentIds.has(id));
      const unsent = attachments.filter(({ id }) => !pendingAttachmentIds.has(id));
      if (pending.length > 0) attachmentsByConversation[conversationId] = pending;
      if (unsent.length > 0) {
        staleAttachmentsByConversation.set(
          conversationId,
          unsent.map(({ id }) => id),
        );
        errors[conversationId] = "Runner 已停止或重启，未发送附件已从草稿移除，请重新选择。";
      }
    }
    if (staleAttachmentsByConversation.size > 0) {
      drafts.setState({ attachmentsByConversation, errors });
      const cleanupFailures: number[] = [];
      for (const [conversationId, ids] of staleAttachmentsByConversation) {
        try {
          for (let offset = 0; offset < ids.length; offset += 3) {
            await client.deleteAttachments(ids.slice(offset, offset + 3));
          }
        } catch {
          cleanupFailures.push(conversationId);
        }
      }
      if (cleanupFailures.length > 0) {
        drafts.setState((state) => {
          const nextErrors = { ...state.errors };
          for (const conversationId of cleanupFailures) {
            nextErrors[conversationId] =
              "Runner 已停止或重启，未发送附件已从草稿移除；暂存文件未能立即删除，会在后续过期清理时处理。";
          }
          return { errors: nextErrors };
        });
      }
    }
    await cache.cancelQueries({ queryKey: runnerKeys.catalog });
    await cache.cancelQueries({ queryKey: runnerKeys.mcpStatuses });
    await cache.cancelQueries({ queryKey: runnerKeys.snapshots });
  }
  function stopRunner() {
    return operation.runAction(async () => {
      await pause();
      try {
        await client.stopRunner();
        cache.removeQueries({ queryKey: runnerKeys.snapshots });
        setLifecycle({ stopped: true, failed: false });
        return true;
      } catch (cause) {
        setLifecycle({ paused: false });
        throw cause;
      }
    });
  }
  function restartRunner() {
    return operation.runAction(async () => {
      await pause();
      // Removing avoids resetQueries refetching observers before the pause renders.
      // Cancellation above prevents late IPC responses from restoring the old cache.
      cache.removeQueries({ queryKey: runnerKeys.snapshots });
      try {
        await client.restartRunner();
        const initial = await client.initialize();
        cache.setQueryData(runnerKeys.catalog, initial);
        updateMcpServerStatuses(cache, initial);
        setLifecycle({ paused: false, stopped: false, failed: false });
        return true;
      } catch (cause) {
        setLifecycle({ failed: true });
        throw cause;
      }
    });
  }
  function reloadConfiguration() {
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      const initial = await client.reloadConfiguration();
      assertCurrent();
      cache.setQueryData(runnerKeys.catalog, initial);
      updateMcpServerStatuses(cache, initial);
      return true;
    });
  }
  function saveConfiguration(path: string, version: string, content: string) {
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      await client.saveConfiguration(path, version, content);
      assertCurrent();
      const initial = await client.initialize();
      assertCurrent();
      cache.setQueryData(runnerKeys.catalog, initial);
      updateMcpServerStatuses(cache, initial);
      return true;
    });
  }
  return {
    ...operation,
    stopRunner,
    restartRunner,
    reloadConfiguration,
    saveConfiguration,
    readConfiguration: async (path: string) => {
      const assertCurrent = captureRunnerSession(cache);
      const file = await client.readConfiguration(path);
      assertCurrent();
      return file;
    },
  };
}

export function useRunnerSettings() {
  const query = useRunnerCatalog();
  const lifecycle = useRunnerLifecycle();
  const actions = useRunnerActions();
  return {
    catalog: query.data,
    connection: {
      loading: query.isPending,
      busy: actions.busy,
      runnerStopped: lifecycle.stopped,
      runnerUnavailable: lifecycle.paused || lifecycle.stopped || lifecycle.failed || query.isError,
      ready: query.data?.configuration.ready ?? false,
      providerConfigured: query.data?.apiKeyConfigured ?? false,
      runtimeVersion: query.data?.runtimeVersion ?? "",
      credentialWarning: query.data?.credentialWarning ?? "",
    },
    feedback: { error: actions.error || query.error?.message || "" },
    actions,
  };
}
