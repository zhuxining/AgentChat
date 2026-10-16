import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { AgentDoc, configure, Harness, type SubmissionId } from "@earendil-works/pi-durable";
import type { Conversation, ConversationId } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { createAgentConfiguration, workGoalExtension } from "./agent-configuration.js";
import { normalizeBot, numberField, parseBot, stringField, type Bot } from "./bot.js";
import { BotsDoc, ConversationDoc, GoalDoc, type ConversationSummary } from "./documents.js";
import { projectMessages } from "./projection.js";
import { prepareProvider } from "./provider.js";

const context = BACKGROUND_CONTEXT;
const maxTextLength = 16_000;

type RunnerOptions = { dataDir: string; models?: MutableModels };

export async function createApplicationRunner({ dataDir, models: providedModels }: RunnerOptions) {
  await mkdir(dataDir, { recursive: true });
  const { models, toolEnvironment, isConfigured, setCredential } = prepareProvider(providedModels);
  const { registry, resolveAgentChange, missingConfiguration } = createAgentConfiguration(models);
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(dataDir, "agentchat.sqlite")),
    {
      models,
      registry,
      env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? dataDir, shellEnv: toolEnvironment }),
    },
    context,
  );
  harness.resume();

  // Serialize application mutations so an idle-only configuration update cannot race a submit.
  let mutationQueue = Promise.resolve();
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function storedBots(): Promise<Bot[]> {
    const bots = (await harness.snapshot(BotsDoc, context))?.bots ?? [];
    return bots.map(normalizeBot);
  }

  async function conversations(): Promise<ConversationSummary[]> {
    return (await harness.snapshot(BotsDoc, context))?.conversations ?? [];
  }

  async function requireConversation(id: number): Promise<Conversation> {
    if (!Number.isSafeInteger(id) || id < 0) throw new Error("无效的 Conversation ID");
    const conversation = await harness.conversation(id as ConversationId, context);
    if (!conversation) throw new Error("Conversation 不存在");
    return conversation;
  }

  async function configurationErrors(conversation: Conversation) {
    const stored = await harness.snapshot(AgentDoc, conversation.id, context);
    return missingConfiguration(stored?.extensions, stored?.tools);
  }

  async function requireAvailableConfiguration(conversation: Conversation) {
    const missing = await configurationErrors(conversation);
    const agent = await conversation.agent(context);
    if (agent.model && !models.getModel(agent.model.provider, agent.model.modelId)) {
      throw new Error(
        `当前 Conversation 的模型「${agent.model.provider}/${agent.model.modelId}」不可用。请编辑 Bot 选择 DeepSeek 模型，再对该 Conversation 显式应用 Bot 设置。`,
      );
    }
    if (missing.missingExtensions.length || missing.missingTools.length) {
      const details = [
        ...missing.missingExtensions.map((name) => `Extension「${name}」`),
        ...missing.missingTools.map((name) => `Tool「${name}」`),
      ].join("、");
      throw new Error(
        `Conversation 配置引用了当前不可用的 ${details}。请编辑 Bot 后显式应用可用配置。`,
      );
    }
  }

  async function requireIdleConversation(conversation: Conversation) {
    const inspection = await harness.inspect(context);
    const liveTasks = inspection.tasks.some(
      (task) => task.record.conversationId === conversation.id,
    );
    const unsettledSubmissions = inspection.submissions.some(
      (submission) =>
        submission.conversationId === conversation.id &&
        (submission.status === "queued" || submission.status === "placed"),
    );
    if (liveTasks || unsettledSubmissions) {
      throw new Error("Conversation 正在运行或有输入排队，必须等它空闲后才能应用 Bot 设置。");
    }
  }

  async function snapshot(id: number) {
    const conversation = await requireConversation(id);
    const state = await conversation.viewState(context);
    const graph = await harness.taskGraph(context);
    try {
      const metadata = await harness.snapshot(ConversationDoc, conversation.id, context);
      const goal = await harness.snapshot(GoalDoc, conversation.id, context);
      const agent = await conversation.agent(context);
      const missing = await configurationErrors(conversation);
      const { messages, hasMoreMessages } = projectMessages(state.value.entries);
      const inspection = await harness.inspect(context);
      const activeTasks = Object.values(graph.value.tasks)
        .filter((task) => task.conversationId === conversation.id)
        .map((task) => ({
          id: task.id,
          kind: task.kind,
          status: task.state.status,
          phase: "phase" in task.state ? task.state.phase : "",
          owner: task.owner ?? null,
          background: task.background,
          abortRequested: task.abortRequested,
        }));
      const submissions = inspection.submissions
        .filter((submission) => submission.conversationId === conversation.id)
        .map((submission) => ({
          id: submission.id,
          type: submission.type,
          status: submission.status,
        }));
      return {
        conversation: {
          id: conversation.id,
          botId: metadata?.botId ?? "",
          botName: metadata?.botName ?? "Conversation",
          botRevision: metadata?.botRevision ?? 0,
          agent: {
            model: agent.model ?? null,
            thinkingLevel: agent.thinkingLevel,
            instructions: agent.instructions ?? "",
            cwd: agent.cwd ?? dataDir,
            extensions: agent.extensions.map((extension) => extension.name),
            tools: agent.callable.map((tool) => tool.name),
          },
        },
        goal: goal ?? { description: "", status: "open", updatedAt: 0, completedAt: null },
        messages,
        hasMoreMessages,
        activeTasks,
        submissions,
        configurationErrors: missing,
        apiKeyConfigured: isConfigured(),
      };
    } finally {
      state.dispose();
      graph.dispose();
    }
  }

  async function handle(request: unknown): Promise<unknown> {
    if (!request || typeof request !== "object") throw new Error("请求格式无效");
    const input = request as Record<string, unknown>;
    switch (input.op) {
      case "initialize": {
        const bots = await storedBots();
        const installed = registry.snapshot();
        return {
          bots,
          conversations: await conversations(),
          capabilities: {
            extensions: installed
              .installed()
              .map((extension) => extension.name)
              .filter((name) => name !== workGoalExtension.name),
            tools: installed
              .tools()
              .map(({ extension, tool }) => ({ name: tool.name, extension: extension.name })),
          },
          apiKeyConfigured: isConfigured(),
          runtimeVersion: process.version,
        };
      }
      case "createBot":
        return mutate(async () => {
          const bot = parseBot(input, {
            id: crypto.randomUUID(),
            revision: 1,
            archived: false,
          });
          resolveAgentChange(bot);
          await harness.commit(async (tx) => {
            const document = await tx.doc(BotsDoc);
            document.bots = [...document.bots.map(normalizeBot), bot];
          }, context);
          return bot;
        });
      case "updateBot":
        return mutate(async () => {
          const botId = stringField(input, "botId", 100);
          const current = (await storedBots()).find((item) => item.id === botId);
          if (!current) throw new Error("Bot 不存在");
          const bot = parseBot(input, {
            ...current,
            revision: current.revision + 1,
            archived: current.archived,
          });
          resolveAgentChange(bot);
          await harness.commit(async (tx) => {
            const document = await tx.doc(BotsDoc);
            document.bots = document.bots.map((item) =>
              item.id === botId ? bot : normalizeBot(item),
            );
          }, context);
          return { bot, bots: await storedBots() };
        });
      case "archiveBot":
        return mutate(async () => {
          const botId = stringField(input, "botId", 100);
          const existing = (await storedBots()).find((item) => item.id === botId);
          if (!existing) throw new Error("Bot 不存在");
          await harness.commit(async (tx) => {
            const document = await tx.doc(BotsDoc);
            document.bots = document.bots.map((bot) =>
              bot.id === botId ? { ...normalizeBot(bot), archived: true } : normalizeBot(bot),
            );
          }, context);
          return { bots: await storedBots() };
        });
      case "createConversation":
        return mutate(async () => {
          const botId = stringField(input, "botId", 100);
          const cwdOverride = stringField(input, "cwd", 2_000, true);
          const goal = stringField(input, "goal", 8_000, true);
          const bot = (await storedBots()).find((item) => item.id === botId && !item.archived);
          if (!bot) throw new Error("Bot 不存在或已归档");
          const agent = resolveAgentChange({ ...bot, cwd: cwdOverride || bot.cwd });
          const conversation = await harness.createConversation(
            {
              ownership: { kind: "ownerless" },
              agent,
              init: async (tx, conversationId) => {
                const createdAt = Date.now();
                const metadata = await tx.doc(ConversationDoc, conversationId);
                metadata.botId = bot.id;
                metadata.botName = bot.name;
                metadata.botRevision = bot.revision;
                metadata.cwdOverride = cwdOverride || null;
                metadata.createdAt = createdAt;
                const goalDocument = await tx.doc(GoalDoc, conversationId);
                goalDocument.description = goal;
                goalDocument.updatedAt = createdAt;
                const document = await tx.doc(BotsDoc);
                document.conversations = [
                  ...document.conversations,
                  {
                    id: conversationId,
                    botId: bot.id,
                    botName: bot.name,
                    botRevision: bot.revision,
                    createdAt,
                  },
                ];
              },
            },
            context,
          );
          return {
            id: conversation.id,
            botId: bot.id,
            botName: bot.name,
            botRevision: bot.revision,
            createdAt: Date.now(),
          };
        });
      case "applyBotSettings":
        return mutate(async () => {
          const conversation = await requireConversation(numberField(input, "conversationId"));
          const metadata = await harness.snapshot(ConversationDoc, conversation.id, context);
          const bot = (await storedBots()).find((item) => item.id === metadata?.botId);
          if (!bot) throw new Error("Conversation 关联的 Bot 已不存在");
          await requireIdleConversation(conversation);
          const change = resolveAgentChange({ ...bot, cwd: metadata?.cwdOverride ?? bot.cwd });
          await harness.commit(async (tx) => {
            await configure(tx, conversation.id, change);
            const conversationMetadata = await tx.doc(ConversationDoc, conversation.id);
            conversationMetadata.botName = bot.name;
            conversationMetadata.botRevision = bot.revision;
            const document = await tx.doc(BotsDoc);
            document.conversations = document.conversations.map((item) =>
              item.id === conversation.id
                ? { ...item, botName: bot.name, botRevision: bot.revision }
                : item,
            );
          }, context);
          return { botRevision: bot.revision };
        });
      case "saveGoal":
        return mutate(async () => {
          const conversation = await requireConversation(numberField(input, "conversationId"));
          const description = stringField(input, "description", 8_000, true);
          const now = Date.now();
          await harness.commit(async (tx) => {
            const goal = await tx.doc(GoalDoc, conversation.id);
            if (goal.description !== description) {
              goal.status = "open";
              goal.completedAt = null;
            }
            goal.description = description;
            goal.updatedAt = now;
          }, context);
          return harness.snapshot(GoalDoc, conversation.id, context);
        });
      case "setGoalStatus":
        return mutate(async () => {
          const conversation = await requireConversation(numberField(input, "conversationId"));
          const status = stringField(input, "status", 16);
          if (status !== "open" && status !== "completed") throw new Error("工作目标状态无效");
          const now = Date.now();
          await harness.commit(async (tx) => {
            const goal = await tx.doc(GoalDoc, conversation.id);
            if (!goal.description.trim()) throw new Error("请先保存工作目标描述");
            goal.status = status;
            goal.completedAt = status === "completed" ? now : null;
            goal.updatedAt = now;
          }, context);
          return harness.snapshot(GoalDoc, conversation.id, context);
        });
      case "submit":
        return mutate(async () => {
          const conversation = await requireConversation(numberField(input, "conversationId"));
          await requireAvailableConfiguration(conversation);
          const text = stringField(input, "text", maxTextLength);
          const requestId = stringField(input, "requestId", 100);
          const submission = await conversation.submit(
            { type: "input", content: text, requestId },
            context,
          );
          return { id: submission.id };
        });
      case "abortSubmission":
        return mutate(async () => {
          const conversationId = numberField(input, "conversationId");
          await requireConversation(conversationId);
          const submissionId = numberField(input, "submissionId");
          const status = await harness.abortSubmission(
            submissionId as SubmissionId,
            context,
            conversationId as ConversationId,
          );
          return { status };
        });
      case "snapshot":
        return snapshot(numberField(input, "conversationId"));
      case "abort":
        return mutate(async () => {
          const conversation = await requireConversation(numberField(input, "conversationId"));
          await conversation.abort(context);
          return { stopped: true };
        });
      case "setProviderCredential":
        return setCredential(input.apiKey);
      case "close":
        await harness.close(context);
        return { closed: true };
      default:
        throw new Error("不支持的 Runner 操作");
    }
  }

  return { handle };
}
