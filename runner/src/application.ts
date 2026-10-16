import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import {
  AgentDoc,
  configure,
  createRegistry,
  defineDoc,
  defineExtension,
  Harness,
  section,
  type AgentChange,
  type AgentState,
  type Extension,
  type JsonObject,
  type ModelRef,
  type SubmissionId,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Conversation, ConversationId } from "@earendil-works/pi-durable";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const context = BACKGROUND_CONTEXT;
const maxTextLength = 16_000;
const maxProjectedMessages = 50;
const maxProjectedTextChars = 2_000;
const toolDefinitions = [createBashTool(), createEditTool(), createReadTool(), createWriteTool()];
const defaultToolNames = toolDefinitions.map((tool) => tool.name);
type ThinkingLevel = Exclude<NonNullable<AgentState["thinkingLevel"]>, "max">;
const thinkingLevels: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];

type Bot = {
  id: string;
  name: string;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  instructions: string;
  cwd: string;
  extensions: string[];
  tools: string[];
  revision: number;
  archived: boolean;
};
type BotsDocument = JsonObject & { bots: Bot[]; conversations: ConversationSummary[] };
type ConversationMetadata = JsonObject & {
  botId: string;
  botName: string;
  botRevision: number;
  cwdOverride: string | null;
  createdAt: number;
};
type ConversationSummary = {
  id: number;
  botId: string;
  botName: string;
  botRevision: number;
  createdAt: number;
};
type GoalDocument = JsonObject & {
  description: string;
  status: "open" | "completed";
  updatedAt: number;
  completedAt: number | null;
};
type MessageProjection = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  truncated: boolean;
};

const BotsDoc = defineDoc<BotsDocument>({
  kind: "app.bots",
  version: 1,
  scope: "session",
  initial: () => ({ bots: [], conversations: [] }),
});
const ConversationDoc = defineDoc<ConversationMetadata>({
  kind: "app.conversation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ botId: "", botName: "Conversation", botRevision: 0, cwdOverride: null, createdAt: 0 }),
});
const GoalDoc = defineDoc<GoalDocument>({
  kind: "app.work-goal",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ description: "", status: "open", updatedAt: 0, completedAt: null }),
});
const workGoalExtension = defineExtension({
  name: "agentchat-work-goal",
  sections: [
    section("work-goal", async ({ conversationId, read }, renderContext) => {
      const goal = await read.snapshot(GoalDoc, conversationId, renderContext);
      if (!goal?.description.trim()) return undefined;
      const status =
        goal.status === "completed"
          ? "The user explicitly marked this goal complete. Do not claim a different completion state; handle new requests normally."
          : "The goal remains open until the user explicitly marks it complete. Ending a run or task does not complete it.";
      return `${goal.description}\n\nGoal status: ${status}`;
    }),
  ],
});
const codingToolsExtension = defineExtension({ name: "coding-tools", tools: toolDefinitions });

type RunnerOptions = { dataDir: string; models?: MutableModels };

export async function createApplicationRunner({ dataDir, models: providedModels }: RunnerOptions) {
  await mkdir(dataDir, { recursive: true });
  let providerApiKey = process.env.OPENAI_API_KEY;
  // NodeExecutionEnv gives child tools their configured shell environment; keep the Provider secret out of it.
  delete process.env.OPENAI_API_KEY;
  const toolEnvironment = { ...process.env };
  const models = providedModels ?? createModels();
  if (!providedModels) {
    const provider = openaiProvider();
    const apiKeyAuth = provider.auth.apiKey;
    if (!apiKeyAuth) throw new Error("OpenAI Provider 未配置 API Key 认证接口");
    models.setProvider({
      ...provider,
      auth: {
        ...provider.auth,
        apiKey: {
          ...apiKeyAuth,
          resolve: async ({ credential, signal }) => {
            signal.throwIfAborted();
            if (credential?.key) {
              return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
            }
            return providerApiKey ? { auth: { apiKey: providerApiKey }, source: "Runner credential" } : undefined;
          },
        },
      },
    });
  }
  const registry = createRegistry();
  registry.install(workGoalExtension);
  registry.install(codingToolsExtension);
  const extensionByName = new Map<string, Extension>(
    registry.snapshot().installed().map((extension) => [extension.name, extension]),
  );
  const toolByName = new Map<string, ToolRegistration>(
    toolDefinitions.map((tool) => [tool.name, tool]),
  );
  const toolExtensionByName = new Map<string, string>(
    toolDefinitions.map((tool) => [tool.name, codingToolsExtension.name]),
  );
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
    mutationQueue = result.then(() => undefined, () => undefined);
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

  function resolveAgentChange(bot: Bot): AgentChange {
    const selectedExtensions = [
      workGoalExtension,
      ...bot.extensions.map((name) => {
        if (name === workGoalExtension.name) throw new Error(`Extension「${name}」由 AgentChat 管理`);
        const extension = extensionByName.get(name);
        if (!extension) throw new Error(`Bot 选择的 Extension「${name}」当前不可用`);
        return extension;
      }),
    ];
    const selectedExtensionNames = new Set(selectedExtensions.map((extension) => extension.name));
    const selectedTools = bot.tools.map((name) => {
      const tool = toolByName.get(name);
      if (!tool) throw new Error(`Bot 选择的 Tool「${name}」当前不可用`);
      const owner = toolExtensionByName.get(name);
      if (!owner || !selectedExtensionNames.has(owner)) {
        throw new Error(`Tool「${name}」所属的 Extension 未启用`);
      }
      return tool;
    });
    return {
      model: bot.model,
      thinkingLevel: bot.thinkingLevel,
      instructions: bot.instructions || null,
      cwd: bot.cwd || null,
      extensions: selectedExtensions,
      tools: selectedTools,
    };
  }

  async function configurationErrors(conversation: Conversation) {
    const stored = await harness.snapshot(AgentDoc, conversation.id, context);
    const requestedExtensions = configuredNames(stored?.extensions);
    const requestedTools = configuredNames(stored?.tools);
    const missingExtensions = requestedExtensions.filter((name) => !extensionByName.has(name));
    const missingTools = requestedTools.filter((name) => !toolByName.has(name));
    return { missingExtensions, missingTools };
  }

  async function requireAvailableConfiguration(conversation: Conversation) {
    const missing = await configurationErrors(conversation);
    if (missing.missingExtensions.length || missing.missingTools.length) {
      const details = [
        ...missing.missingExtensions.map((name) => `Extension「${name}」`),
        ...missing.missingTools.map((name) => `Tool「${name}」`),
      ].join("、");
      throw new Error(`Conversation 配置引用了当前不可用的 ${details}。请编辑 Bot 后显式应用可用配置。`);
    }
  }

  async function requireIdleConversation(conversation: Conversation) {
    const inspection = await harness.inspect(context);
    const liveTasks = inspection.tasks.some((task) => task.record.conversationId === conversation.id);
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
      const messages: MessageProjection[] = state.value.entries
        .slice(-maxProjectedMessages)
        .map((entry) => {
          const model = entry.model?.[0] as
            | { role?: string; content?: unknown }
            | undefined;
          const text = Array.isArray(model?.content)
            ? model.content
                .map((part) => {
                  if (!part || typeof part !== "object") return "";
                  const item = part as { type?: string; text?: string; name?: string };
                  if (item.type === "text") return item.text ?? "";
                  if (item.type === "toolCall") return `调用工具：${item.name ?? "工具"}`;
                  return "";
                })
                .filter(Boolean)
                .join("\n")
            : "";
          const role =
            model?.role === "user"
              ? "user"
              : model?.role === "assistant"
                ? "assistant"
                : model?.role === "system"
                  ? "system"
                  : "tool";
          const limitedText = limitText(text);
          return { id: entry.id, role, text: limitedText.text, truncated: limitedText.truncated };
        });
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
        .map((submission) => ({ id: submission.id, type: submission.type, status: submission.status }));
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
        hasMoreMessages: state.value.entries.length > maxProjectedMessages,
        activeTasks,
        submissions,
        configurationErrors: missing,
        apiKeyConfigured: Boolean(providerApiKey),
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
            tools: installed.tools().map(({ extension, tool }) => ({ name: tool.name, extension: extension.name })),
          },
          apiKeyConfigured: Boolean(providerApiKey),
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
            document.bots = document.bots.map((item) => (item.id === botId ? bot : normalizeBot(item)));
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
                  { id: conversationId, botId: bot.id, botName: bot.name, botRevision: bot.revision, createdAt },
                ];
              },
            },
            context,
          );
          return { id: conversation.id, botId: bot.id, botName: bot.name, botRevision: bot.revision, createdAt: Date.now() };
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
          const submission = await conversation.submit({ type: "input", content: text, requestId }, context);
          return { id: submission.id };
        });
      case "abortSubmission":
        return mutate(async () => {
          const conversationId = numberField(input, "conversationId");
          await requireConversation(conversationId);
          const submissionId = numberField(input, "submissionId");
          const status = await harness.abortSubmission(submissionId as SubmissionId, context, conversationId as ConversationId);
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
      case "setProviderCredential": {
        const apiKey = input.apiKey;
        if (apiKey !== null && (typeof apiKey !== "string" || apiKey.trim().length === 0 || apiKey.length > 8_000)) {
          throw new Error("Provider 凭据无效");
        }
        providerApiKey = apiKey === null ? undefined : apiKey;
        return { configured: Boolean(providerApiKey) };
      }
      case "close":
        await harness.close(context);
        return { closed: true };
      default:
        throw new Error("不支持的 Runner 操作");
    }
  }

  return { handle };
}

function normalizeBot(bot: Bot): Bot {
  return {
    ...bot,
    thinkingLevel: thinkingLevels.includes(bot.thinkingLevel) ? bot.thinkingLevel : "medium",
    extensions: Array.isArray(bot.extensions) ? bot.extensions.filter((name) => typeof name === "string") : [codingToolsExtension.name],
    tools: Array.isArray(bot.tools) ? bot.tools.filter((name) => typeof name === "string") : defaultToolNames,
    revision: Number.isSafeInteger(bot.revision) && bot.revision > 0 ? bot.revision : 1,
    archived: bot.archived === true,
  };
}

function parseBot(
  input: Record<string, unknown>,
  base: Pick<Bot, "id" | "revision" | "archived">,
): Bot {
  const name = stringField(input, "name", 80);
  const modelId = stringField(input, "modelId", 120);
  const instructions = stringField(input, "instructions", 8_000, true);
  const cwd = stringField(input, "cwd", 2_000, true);
  const thinkingLevel = stringField(input, "thinkingLevel", 16) as ThinkingLevel;
  if (!thinkingLevels.includes(thinkingLevel)) throw new Error("Thinking Level 无效");
  const extensions = stringArrayField(input, "extensions", 30);
  const tools = stringArrayField(input, "tools", 100);
  if (new Set(extensions).size !== extensions.length || new Set(tools).size !== tools.length) {
    throw new Error("Extension 或 Tool 不能重复");
  }
  return {
    ...base,
    name,
    model: { provider: "openai", modelId },
    thinkingLevel,
    instructions,
    cwd,
    extensions,
    tools,
  };
}

function configuredNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((name): name is string => typeof name === "string");
  if (value && typeof value === "object" && "add" in value) {
    const add = (value as { add?: unknown }).add;
    if (Array.isArray(add)) return add.filter((name): name is string => typeof name === "string");
  }
  return [];
}

function limitText(value: string): { text: string; truncated: boolean } {
  const characters = Array.from(value);
  return {
    text: characters.slice(0, maxProjectedTextChars).join(""),
    truncated: characters.length > maxProjectedTextChars,
  };
}

function stringField(
  input: Record<string, unknown>,
  name: string,
  maxLength: number,
  optional = false,
): string {
  const value = input[name];
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`字段 ${name} 无效`);
  if (!optional && value.trim().length === 0) throw new Error(`字段 ${name} 不能为空`);
  return value.trim();
}

function stringArrayField(input: Record<string, unknown>, name: string, maxItems: number): string[] {
  const value = input[name];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) {
    throw new Error(`字段 ${name} 无效`);
  }
  const values = value.map((item) => (item as string).trim());
  if (values.some((item) => item.length === 0 || item.length > 120)) throw new Error(`字段 ${name} 无效`);
  return values;
}

function numberField(input: Record<string, unknown>, name: string): number {
  const value = input[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`字段 ${name} 无效`);
  }
  return value;
}
