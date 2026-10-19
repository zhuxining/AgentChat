import { useQueryClient } from "@tanstack/react-query";

import type { InitializeResult } from "@/app/runner-client";
import {
  captureRunnerSession,
  runnerKeys,
  useRunnerCatalog,
  useRunnerLifecycle,
  type RunnerLifecycle,
} from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useWorkspaceResources } from "@/app/workspace-provider";

export function useRunnerActions() {
  const { client } = useWorkspaceResources();
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
    await cache.cancelQueries({ queryKey: runnerKeys.catalog });
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
      return true;
    });
  }
  function setProviderCredential(apiKey: string | null) {
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      const result = await client.setProviderCredential(apiKey);
      assertCurrent();
      cache.setQueryData<InitializeResult>(runnerKeys.catalog, (current) =>
        current
          ? { ...current, apiKeyConfigured: result.configured, credentialWarning: "" }
          : current,
      );
      await cache.invalidateQueries({ queryKey: runnerKeys.snapshots });
      return true;
    });
  }
  return {
    ...operation,
    stopRunner,
    restartRunner,
    reloadConfiguration,
    saveConfiguration,
    setProviderCredential,
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
