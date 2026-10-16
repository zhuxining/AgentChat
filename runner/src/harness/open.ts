import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Configuration, type Bot } from "../config/configuration.js";
import { createAgentResolver } from "./agent.js";
import { executionEnvironment } from "./environment.js";
import { workGoalExtension } from "./extensions/work-goal.js";
import { prepareProvider } from "./models.js";
import { createOperations } from "./operations.js";
import { createRunnerRegistry } from "./registry.js";
import { harnessSettings } from "./settings.js";
import { createViews } from "./views.js";

const context = BACKGROUND_CONTEXT;
export type RunnerOptions = { dataDir: string; models?: MutableModels };

export async function openRunner({ dataDir, models: providedModels }: RunnerOptions) {
  const provider = prepareProvider(providedModels);
  const registry = createRunnerRegistry();
  const catalog = createModels();
  for (const item of provider.models.getProviders()) catalog.setProvider(item);
  const catalogResolver = createAgentResolver(catalog, registry);
  const configuration = await Configuration.open(dataDir, (choices) => {
    catalogResolver.resolve(choices);
  });
  const resolver = createAgentResolver(provider.models, registry);
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
    if (!providedModels && !configuration.runner?.providers.deepseek) {
      provider.models.deleteProvider("deepseek");
    }
    await mkdir(join(dataDir, "state"), { recursive: true });
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(dataDir, "state", "runner.sqlite")),
      {
        models: provider.models,
        registry,
        settings: harnessSettings(() => configuration.runner?.harness),
        env: executionEnvironment(provider.toolEnvironment),
      },
      context,
    );
    openedProviders = JSON.stringify(configuration.runner?.providers);
    const operations = createOperations(harness, configuration, provider.models, resolver);
    const snapshot = createViews(harness, resolver, provider.isConfigured);
    harness.resume();
    return { harness, operations, snapshot };
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
      providers: provider.models.getProviders().map((item) => ({
        name: item.id,
        models: provider.models.getModels(item.id).map((model) => model.id),
      })),
      apiKeyConfigured: provider.isConfigured(),
      runtimeVersion: process.version,
    };
  }
  return {
    initialize,
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
    setProviderCredential: provider.setCredential,
    close: async () => {
      closing = true;
      await configQueue;
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
