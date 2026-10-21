import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { AgentDoc, type Cursor, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import type { ProviderReference } from "../../../contracts/providers.js";
import { localNativeAdapter, type NativeAdapter } from "../communication/native.js";
import { Configuration, type Bot } from "../config/configuration.js";
import { createInstanceRuntime, instancesOf, builtins } from "../providers/runtime.js";
import { ProviderService } from "../providers/service.js";
import { ProviderState } from "../providers/state.js";
import { createAgentResolver } from "./agent.js";
import { createAuthStatus } from "./auth-status.js";
import { executionEnvironment } from "./environment.js";
import { botMemoryExtension } from "./extensions/bot-memory.js";
import { workGoalExtension } from "./extensions/work-goal.js";
import { createMcpServerManager, mcpToolPrefix } from "./mcp.js";
import { prepareProvider } from "./models.js";
import { createOperations } from "./operations/index.js";
import { createRunnerRegistry } from "./registry.js";
import { harnessSettings } from "./settings.js";
import { createViews } from "./views.js";

const context = BACKGROUND_CONTEXT;
const CLOSE_TIMEOUT_MS = 4_000;

function waitAtMost(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export type RunnerOptions = {
  dataDir: string;
  models?: MutableModels;
  native?: NativeAdapter;
  migrateCredentials?: boolean;
};

export async function openRunner({
  dataDir,
  models: providedModels,
  native: suppliedNative,
  migrateCredentials = false,
}: RunnerOptions) {
  const ambientEnvironment = { ...process.env };
  const provider = prepareProvider(providedModels);
  // The in-process legacy key is only for reading an unmigrated schemaVersion 1 file.
  // Schema 2 instances must resolve their explicitly selected source.
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const providerState = await ProviderState.open(dataDir);
  let authRevision = 0;
  const rawNative = suppliedNative ?? localNativeAdapter(ambientEnvironment);
  const native: NativeAdapter = {
    ...rawNative,
    async writeCredential(source, credential) {
      await rawNative.writeCredential(source, credential);
      authRevision++;
      await providerState.touch();
    },
    async deleteCredential(source) {
      await rawNative.deleteCredential(source);
      authRevision++;
      await providerState.touch();
    },
  };
  let models = providedModels ?? createModels();
  const registry = createRunnerRegistry();
  const configuredMcpIds = new Set<string>();
  const mcp = createMcpServerManager(registry, dataDir);
  const catalog = createModels();
  for (const item of providedModels?.getProviders() ?? builtins()) catalog.setProvider(item);
  const catalogResolver = createAgentResolver(catalog, registry);
  let currentSchema = 1;
  const legacyCredential = () => (currentSchema === 1 ? provider.legacyCredential() : undefined);
  const configuration = await Configuration.open(
    dataDir,
    (choices) => {
      const mcpExtensions = new Set([...configuredMcpIds].map((id) => `mcp-${id}`));
      const mcpToolPrefixes = [...configuredMcpIds].map(mcpToolPrefix);
      catalogResolver.resolve({
        ...choices,
        extensions: choices.extensions.filter((name) => !mcpExtensions.has(name)),
        tools: choices.tools.filter(
          (name) => !mcpToolPrefixes.some((prefix) => name.startsWith(prefix)),
        ),
      });
    },
    (runner) => {
      currentSchema = runner.schemaVersion;
      configuredMcpIds.clear();
      for (const server of runner.mcpServers) configuredMcpIds.add(server.id);
      if (providedModels) return;
      const desired = createInstanceRuntime(instancesOf(runner), native, {
        legacyCredential,
        state: providerState,
      });
      catalog.clearProviders();
      for (const item of desired.models.getProviders()) catalog.setProvider(item);
    },
  );
  if (migrateCredentials && !providedModels && configuration.runner?.schemaVersion === 1) {
    const runner = configuration.runner;
    const instances = instancesOf(runner);
    for (const item of instances) {
      const stored = await native
        .readCredential({ type: "keyring", entry: "deepseek-api-key" })
        .catch(() => null);
      item.auth = {
        type: "apiKey",
        source: stored
          ? { type: "keyring", entry: "deepseek-api-key" }
          : { type: "env", variable: "DEEPSEEK_API_KEY" },
      };
    }
    const file = await configuration.readConfiguration("runner.json");
    await configuration.saveConfiguration(
      file.path,
      file.version,
      JSON.stringify(
        {
          ...runner,
          schemaVersion: 2,
          providers: Object.fromEntries(instances.map((item) => [item.id, item])),
        },
        null,
        2,
      ) + "\n",
    );
  }
  if (!providedModels)
    models = createInstanceRuntime(instancesOf(configuration.runner), native, {
      legacyCredential,
      state: providerState,
    }).models;
  let resolver = createAgentResolver(models, registry);
  let openedProviders: string | undefined;
  let active: Awaited<ReturnType<typeof start>> | undefined;
  let closing = false;
  let closePromise: Promise<{ closed: true }> | undefined;
  const authStatus = createAuthStatus(
    async (id) => (providedModels ? provider.isConfigured() : Boolean(await models.checkAuth(id))),
    () => `${authRevision}:${providerState.credentialRevision}`,
  );
  const isConfigured = async (id: string | undefined) => {
    try {
      return await authStatus(id);
    } catch {
      return false;
    }
  };
  let configQueue = Promise.resolve();
  function configure<T>(operation: () => Promise<T>): Promise<T> {
    const result = configQueue.then(() => {
      if (closing) throw new Error("Runner 正在关闭");
      return operation();
    });
    configQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function start() {
    if (!providedModels) {
      const runtime = createInstanceRuntime(instancesOf(configuration.runner), native, {
        legacyCredential,
        state: providerState,
      });
      models = runtime.models;
      resolver = createAgentResolver(models, registry);
    }
    await mkdir(join(dataDir, "state"), { recursive: true });
    const storage = await openNodeSqliteStorage(join(dataDir, "state", "runner.sqlite"));
    const harness = await Harness.open(
      storage,
      {
        models,
        registry,
        settings: harnessSettings(() => configuration.runner?.harness),
        env: executionEnvironment(provider.toolEnvironment),
      },
      context,
    );
    openedProviders = JSON.stringify(configuration.runner?.providers);
    const operations = createOperations(harness, configuration, models, resolver, dataDir);
    const views = createViews(harness, storage, resolver, isConfigured);
    harness.resume();
    return { harness, storage, operations, ...views };
  }
  async function ensureStarted() {
    if (closing) return;
    if (!active && configuration.runner) {
      const started = await start();
      if (closing) {
        await started.operations.mutate(() => started.harness.close(context));
        return;
      }
      active = started;
    }
  }
  function execution() {
    if (closing) throw new Error("Runner 正在关闭");
    if (!configuration.runner || !active) throw new Error("Runner 配置无效，请修复并重新加载配置");
    return active;
  }
  const configurationStatus = () => {
    const errors = [...configuration.errors];
    for (const bot of configuration.bots()) {
      try {
        resolver.resolve(bot);
      } catch (error) {
        errors.push({
          path: "bots/" + bot.id + "/bot.json",
          botId: bot.id,
          message: error instanceof Error ? error.message : "Bot 能力配置不可用",
        });
      }
    }
    return {
      errors,
      ready: Boolean(configuration.ready && active),
      dataDir: configuration.dataDir,
      restartRequired:
        openedProviders !== undefined &&
        openedProviders !== JSON.stringify(configuration.runner?.providers),
      files: configuration.paths(),
    };
  };
  const providers = new ProviderService(
    configuration,
    native,
    () => openedProviders,
    async () => {
      const refs: (ProviderReference & { provider: string })[] = [];
      const defaults = configuration.runner?.botDefaults.model;
      if (defaults)
        refs.push({
          kind: "defaults",
          id: "runner",
          modelId: defaults.modelId,
          provider: defaults.provider,
        });
      for (const path of configuration
        .paths()
        .filter((path) => /^bots\/[^/]+\/bot\.json$/.test(path))) {
        try {
          const raw: unknown = JSON.parse((await configuration.readConfiguration(path)).content);
          if (
            raw &&
            typeof raw === "object" &&
            "agent" in raw &&
            raw.agent &&
            typeof raw.agent === "object" &&
            "model" in raw.agent &&
            raw.agent.model &&
            typeof raw.agent.model === "object" &&
            "provider" in raw.agent.model &&
            typeof raw.agent.model.provider === "string" &&
            "modelId" in raw.agent.model &&
            typeof raw.agent.model.modelId === "string"
          )
            refs.push({
              kind: "bot",
              id: path.split("/")[1]!,
              modelId: raw.agent.model.modelId,
              provider: raw.agent.model.provider,
            });
        } catch {
          throw new Error("Bot 配置无法检查引用，请先修复配置");
        }
      }
      if (active) {
        let cursor: Cursor | undefined;
        do {
          const page = await active.storage.scanConversations({}, 100, cursor, context);
          for (const conversation of page.items) {
            const agent = await active.harness.snapshot(AgentDoc, conversation.id, context);
            if (agent?.model)
              refs.push({
                kind: "conversation",
                id: String(conversation.id),
                modelId: agent.model.modelId,
                provider: agent.model.provider,
              });
          }
          cursor = page.next;
        } while (cursor);
      }
      return refs;
    },
    legacyCredential,
    providerState,
  );
  configuration.beforeRunnerSave = (next) => providers.validateChange(next);
  await mcp.sync(configuration.runner?.mcpServers ?? []);
  await configuration.reload();
  await ensureStarted();
  async function initialize() {
    const installed = registry.snapshot();
    return {
      bots: configuration.bots(),
      conversations: active ? await active.operations.conversations() : [],
      mcpServers: mcp.statuses(),
      queryCapabilities: { botSummaries: true, attachments: true },
      capabilities: {
        extensions: installed
          .installed()
          .map((item) => item.name)
          .filter((name) => name !== workGoalExtension.name && name !== botMemoryExtension.name),
        tools: installed.tools().map(({ extension, tool }) => ({
          name: tool.name,
          extension: extension.name,
          ...(mcp.displayName(tool.name) ? { displayName: mcp.displayName(tool.name) } : {}),
        })),
      },
      botDefaults: configuration.runner
        ? {
            provider: configuration.runner.botDefaults.model.provider,
            modelId: configuration.runner.botDefaults.model.modelId,
            thinkingLevel: configuration.runner.botDefaults.thinkingLevel,
            instructions: configuration.runner.botDefaults.instructions,
            extensions: configuration.runner.botDefaults.extensions,
            tools: configuration.runner.botDefaults.tools,
            cwd: "",
          }
        : null,
      configuration: configurationStatus(),
      // Provider and model options let the UI offer direct choices instead of free text.
      providers: models
        .getProviders()
        .filter(
          (item) =>
            instancesOf(configuration.runner).find((instance) => instance.id === item.id)
              ?.enabled !== false,
        )
        .map((item) => ({
          label: item.name,
          name: item.id,
          models: models
            .getModels(item.id)
            .filter((model) => {
              const instance = instancesOf(configuration.runner).find(
                (value) => value.id === item.id,
              );
              return !instance || instance.visibleModels.includes(model.id);
            })
            .map((model) => model.id),
        })),
      apiKeyConfigured: await isConfigured(configuration.runner?.botDefaults.model.provider),
      runtimeVersion: process.version,
    };
  }
  return {
    initialize,
    mcpStatuses: () => mcp.statuses(),
    // Config mutations serialize with other Runner configuration changes. Status, test and
    // OAuth interaction stay direct so a running model test cannot block login polling/cancel.
    providerRequest: (request: unknown) => {
      const action =
        request && typeof request === "object" && "action" in request
          ? (request as { action?: unknown }).action
          : undefined;
      if (action !== "save" && action !== "remove" && action !== "writeCredential")
        return providers.request(request);
      return configure(async () => {
        const result = await providers.request(request);
        authRevision++;
        return result;
      });
    },
    createBot: (draft: Partial<Bot> & { name: string }) =>
      configure(async () => {
        const defaults = configuration.runner?.botDefaults;
        if (!defaults) throw new Error("Runner 配置无效");
        resolver.resolve({ ...defaults, ...draft, cwd: draft.cwd || dataDir });
        return configuration.createBot(draft);
      }),
    updateBot: (botId: string, draft: Partial<Bot>, version: string) =>
      configure(async () => {
        const current = configuration.requireBot(botId);
        const next = { ...current, ...draft, id: botId, cwd: draft.cwd || current.cwd };
        resolver.resolve(next);
        const bot = await configuration.updateBot(next, version);
        return { bot, bots: configuration.bots() };
      }),
    archiveBot: (id: string, version: string) =>
      configure(async () => {
        await configuration.archiveBot(id, version);
        return { bots: configuration.bots() };
      }),
    readBotMemory: (botId: string) => execution().operations.readBotMemory(botId),
    saveBotMemory: (botId: string, expectedRevision: number, content: string) =>
      execution().operations.saveBotMemory(botId, expectedRevision, content),
    reloadConfiguration: () =>
      configure(async () => {
        await configuration.reload();
        await mcp.sync(configuration.runner?.mcpServers ?? []);
        await configuration.reload();
        authRevision++;
        await ensureStarted();
        return initialize();
      }),
    readConfiguration: (path: string) => configure(() => configuration.readConfiguration(path)),
    saveConfiguration: (path: string, version: string, content: string) =>
      configure(async () => {
        await configuration.saveConfiguration(path, version, content);
        await mcp.sync(configuration.runner?.mcpServers ?? []);
        await configuration.reload();
        authRevision++;
        await ensureStarted();
        return { saved: true };
      }),
    createConversation: (input: { botId: string; cwd: string; goal: string }) =>
      execution().operations.createConversation(input),
    applyBotSettings: (id: number) => execution().operations.applyBotSettings(id),
    saveGoal: (id: number, description: string) => execution().operations.saveGoal(id, description),
    setGoalStatus: (id: number, status: "open" | "completed") =>
      execution().operations.setGoalStatus(id, status),
    submit: (input: {
      conversationId: number;
      text: string;
      requestId: string;
      attachments?: { id: string; name: string }[];
    }) => execution().operations.submit(input),
    abortSubmission: (id: number, submissionId: number) =>
      execution().operations.abortSubmission(id, submissionId),
    abort: (id: number) => execution().operations.abort(id),
    snapshot: (id: number) => execution().snapshot(id),
    chatHistory: (id: number, cursor: string | null) => execution().chatHistory(id, cursor),
    botSummaries: async () => {
      const current = execution();
      return current.botSummaries(configuration.bots(), await current.operations.conversations());
    },
    setProviderCredential: (value: unknown) => {
      const result = provider.setCredential(value);
      authRevision++;
      return result;
    },
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      const cleanup: Promise<unknown>[] = [configQueue, providers.close(), mcp.close()];
      if (active) {
        const current = active;
        cleanup.push(current.operations.mutate(() => current.harness.close(context)));
      }
      closePromise = (async () => {
        await waitAtMost(Promise.allSettled(cleanup), CLOSE_TIMEOUT_MS);
        active = undefined;
        return { closed: true };
      })();
      return closePromise;
    },
  };
}

export type Runner = Awaited<ReturnType<typeof openRunner>>;
