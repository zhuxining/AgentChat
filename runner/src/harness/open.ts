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
import { executionEnvironment } from "./environment.js";
import { workGoalExtension } from "./extensions/work-goal.js";
import { prepareProvider } from "./models.js";
import { createOperations } from "./operations/index.js";
import { createRunnerRegistry } from "./registry.js";
import { harnessSettings } from "./settings.js";
import { createViews } from "./views.js";

const context = BACKGROUND_CONTEXT;
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
  const rawNative = suppliedNative ?? localNativeAdapter(ambientEnvironment);
  const native: NativeAdapter = {
    ...rawNative,
    async writeCredential(source, credential) {
      await rawNative.writeCredential(source, credential);
      await providerState.touch();
    },
    async deleteCredential(source) {
      await rawNative.deleteCredential(source);
      await providerState.touch();
    },
  };
  let models = providedModels ?? createModels();
  const registry = createRunnerRegistry();
  const catalog = createModels();
  for (const item of providedModels?.getProviders() ?? builtins()) catalog.setProvider(item);
  const catalogResolver = createAgentResolver(catalog, registry);
  let currentSchema = 1;
  const legacyCredential = () => (currentSchema === 1 ? provider.legacyCredential() : undefined);
  const configuration = await Configuration.open(
    dataDir,
    (choices) => {
      catalogResolver.resolve(choices);
    },
    (runner) => {
      currentSchema = runner.schemaVersion;
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
    const operations = createOperations(harness, configuration, models, resolver);
    const snapshot = createViews(harness, resolver, async (id) => {
      if (providedModels) return provider.isConfigured();
      try {
        return Boolean(id && (await models.checkAuth(id)));
      } catch {
        return false;
      }
    });
    harness.resume();
    return { harness, storage, operations, snapshot };
  }
  async function ensureStarted() {
    if (!active && configuration.runner) active = await start();
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
  await ensureStarted();
  async function initialize() {
    const installed = registry.snapshot();
    return {
      bots: configuration.bots(),
      conversations: active ? await active.operations.conversations() : [],
      capabilities: {
        extensions: installed
          .installed()
          .map((item) => item.name)
          .filter((name) => name !== workGoalExtension.name),
        tools: installed
          .tools()
          .map(({ extension, tool }) => ({ name: tool.name, extension: extension.name })),
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
      apiKeyConfigured: providedModels
        ? provider.isConfigured()
        : await models
            .checkAuth(configuration.runner?.botDefaults.model.provider ?? "")
            .then(Boolean, () => false),
      runtimeVersion: process.version,
    };
  }
  return {
    initialize,
    // Config mutations serialize with other Runner configuration changes. Status, test and
    // OAuth interaction stay direct so a running model test cannot block login polling/cancel.
    providerRequest: (request: unknown) => {
      const action =
        request && typeof request === "object" && "action" in request
          ? (request as { action?: unknown }).action
          : undefined;
      if (action !== "save" && action !== "remove" && action !== "writeCredential")
        return providers.request(request);
      return configure(() => providers.request(request));
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
    reloadConfiguration: () =>
      configure(async () => {
        await configuration.reload();
        await ensureStarted();
        return initialize();
      }),
    readConfiguration: (path: string) => configure(() => configuration.readConfiguration(path)),
    saveConfiguration: (path: string, version: string, content: string) =>
      configure(async () => {
        await configuration.saveConfiguration(path, version, content);
        await ensureStarted();
        return { saved: true };
      }),
    createConversation: (input: { botId: string; cwd: string; goal: string }) =>
      execution().operations.createConversation(input),
    applyBotSettings: (id: number) => execution().operations.applyBotSettings(id),
    saveGoal: (id: number, description: string) => execution().operations.saveGoal(id, description),
    setGoalStatus: (id: number, status: "open" | "completed") =>
      execution().operations.setGoalStatus(id, status),
    submit: (input: { conversationId: number; text: string; requestId: string }) =>
      execution().operations.submit(input),
    abortSubmission: (id: number, submissionId: number) =>
      execution().operations.abortSubmission(id, submissionId),
    abort: (id: number) => execution().operations.abort(id),
    snapshot: (id: number) => execution().snapshot(id),
    setProviderCredential: (value: unknown) => provider.setCredential(value),
    close: async () => {
      closing = true;
      await configQueue;
      await providers.close();
      if (active) {
        const current = active;
        await current.operations.mutate(() => current.harness.close(context));
        active = undefined;
      }
      return { closed: true };
    },
  };
}

export type Runner = Awaited<ReturnType<typeof openRunner>>;
