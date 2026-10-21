import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AgentDoc,
  UsageDoc,
  type Harness,
  type Storage,
  type UsageState,
} from "@earendil-works/pi-durable";

import type { Bot } from "../config/configuration.js";
import type { createAgentResolver } from "./agent.js";
import { GoalState } from "./extensions/work-goal.js";
import {
  readChatHistoryConversationPage,
  readProjectedMessages,
  type ChatHistoryMessage,
  type ConversationHistoryScan,
} from "./messages.js";
import { conversationById } from "./operations/index.js";
import {
  ConversationIndex,
  ConversationMetadata,
  type ConversationSummary,
} from "./product-state.js";

export type BotListSummary = {
  botId: string;
  conversationId: number | null;
  latestMessage: string;
  executing: boolean;
};

export type ConversationUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
  models: ModelUsageSummary[];
};

export type ModelUsageSummary = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

function summarizeUsage(state: UsageState | undefined): ConversationUsage {
  const models = Object.entries(state?.models ?? {})
    .filter(
      ([, usage]) =>
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite + usage.totalTokens > 0,
    )
    .map(([model, usage]) => ({
      model,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      totalTokens: usage.totalTokens,
      costUsd: usage.cost.total > 0 ? usage.cost.total : null,
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
  let costUsd = 0;
  let pricingAvailable = false;
  let pricingComplete = true;
  for (const usage of models) {
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cacheReadTokens += usage.cacheReadTokens;
    totals.cacheWriteTokens += usage.cacheWriteTokens;
    totals.totalTokens += usage.totalTokens;
    if (usage.costUsd !== null) {
      pricingAvailable = true;
      costUsd += usage.costUsd;
    } else {
      pricingComplete = false;
    }
  }
  return {
    ...totals,
    costUsd: pricingAvailable && pricingComplete ? costUsd : null,
    models,
  };
}

const context = BACKGROUND_CONTEXT;
const chatHistoryPageSize = 50;
const maxHistoryCursorLength = 16_384;

type EncodedHistoryCursor = {
  version: 1;
  anchorConversationId: number;
  botId: string;
  conversationId: number;
  scan: ConversationHistoryScan;
};

export function createViews(
  harness: Harness,
  storage: Storage,
  resolver: ReturnType<typeof createAgentResolver>,
  isConfigured: (providerId: string | undefined) => Promise<boolean> | boolean,
) {
  const historyCursorKey = randomBytes(32);

  function encodeHistoryCursor(cursor: EncodedHistoryCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    const signature = createHmac("sha256", historyCursorKey).update(payload).digest("base64url");
    const token = `${payload}.${signature}`;
    if (token.length > maxHistoryCursorLength) throw new Error("历史游标无效");
    return token;
  }

  function decodeHistoryCursor(token: string): EncodedHistoryCursor {
    if (token.length > maxHistoryCursorLength) throw new Error("历史游标无效");
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) throw new Error("历史游标无效");
    const supplied = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", historyCursorKey).update(payload).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("历史游标无效");
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new Error("历史游标无效");
    }
    if (!isHistoryCursor(value)) throw new Error("历史游标无效");
    return value;
  }

  async function configurationErrors(conversation: { id: Parameters<Harness["conversation"]>[0] }) {
    const agent = await harness.snapshot(AgentDoc, conversation.id, context);
    return resolver.missing(agent?.extensions, agent?.tools);
  }
  async function snapshot(id: number) {
    const conversation = await conversationById(harness, id);
    const graph = await harness.taskGraph(context);
    try {
      const metadata = await harness.snapshot(ConversationMetadata, conversation.id, context);
      const goal = await harness.snapshot(GoalState, conversation.id, context);
      const usage = await harness.snapshot(UsageDoc, conversation.id, context);
      const agent = await conversation.agent(context);
      const missing = await configurationErrors(conversation);
      const { messages, hasMoreMessages } = await readProjectedMessages(storage, conversation.id);
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
          botConfigVersion: metadata?.botConfigVersion ?? "",
          agent: {
            model: agent.model ?? null,
            thinkingLevel: agent.thinkingLevel,
            instructions: agent.instructions ?? "",
            cwd: agent.cwd ?? "",
            extensions: agent.extensions.map((extension) => extension.name),
            tools: agent.callable.map((tool) => tool.name),
          },
        },
        goal: goal ?? { description: "", status: "open", updatedAt: 0, completedAt: null },
        usage: summarizeUsage(usage),
        messages,
        hasMoreMessages,
        activeTasks,
        submissions,
        configurationErrors: missing,
        apiKeyConfigured: await isConfigured(agent.model?.provider),
      };
    } finally {
      graph.dispose();
    }
  }
  async function chatHistory(
    anchorConversationId: number,
    token: string | null,
  ): Promise<{ messages: ChatHistoryMessage[]; cursor: string | null }> {
    const index = await harness.snapshot(ConversationIndex, context);
    const allConversations = [...(index?.conversations ?? [])].sort(
      (left, right) => left.createdAt - right.createdAt || left.id - right.id,
    );
    const anchor = allConversations.find((conversation) => conversation.id === anchorConversationId);
    if (!anchor) throw new Error("Conversation 不存在");
    const conversations = allConversations.filter((conversation) => conversation.botId === anchor.botId);
    const anchorIndex = conversations.findIndex((conversation) => conversation.id === anchor.id);
    const current = token
      ? decodeHistoryCursor(token)
      : {
          version: 1 as const,
          anchorConversationId,
          botId: anchor.botId,
          conversationId: anchorConversationId,
          scan: {},
        };
    if (current.anchorConversationId !== anchorConversationId || current.botId !== anchor.botId) {
      throw new Error("历史游标无效");
    }
    let currentIndex = conversations.findIndex(
      (conversation) => conversation.id === current.conversationId,
    );
    if (currentIndex < 0 || currentIndex > anchorIndex) throw new Error("历史游标无效");

    const messages: ChatHistoryMessage[] = [];
    let nextCursor: EncodedHistoryCursor | undefined = current;
    while (messages.length < chatHistoryPageSize && nextCursor) {
      currentIndex = conversations.findIndex(
        (conversation) => conversation.id === nextCursor?.conversationId,
      );
      if (currentIndex < 0 || currentIndex > anchorIndex) throw new Error("历史游标无效");
      const summary = conversations[currentIndex];
      if (!summary) throw new Error("历史游标无效");
      const conversation = await conversationById(harness, summary.id);
      const page = await readChatHistoryConversationPage(
        storage,
        conversation.id,
        nextCursor.scan,
        chatHistoryPageSize - messages.length,
      );
      messages.push(...page.messages);
      if (!page.done) {
        nextCursor = { ...nextCursor, scan: page.scan };
        break;
      }
      const previous = conversations[currentIndex - 1];
      nextCursor = previous
        ? {
            version: 1,
            anchorConversationId,
            botId: anchor.botId,
            conversationId: previous.id,
            scan: {},
          }
        : undefined;
    }
    return {
      messages: messages.reverse(),
      cursor: nextCursor ? encodeHistoryCursor(nextCursor) : null,
    };
  }

  async function botSummaries(
    bots: Bot[],
    conversations: ConversationSummary[],
  ): Promise<BotListSummary[]> {
    const latest = new Map<string, ConversationSummary>();
    for (const conversation of conversations) {
      const current = latest.get(conversation.botId);
      if (
        !current ||
        conversation.createdAt > current.createdAt ||
        (conversation.createdAt === current.createdAt && conversation.id > current.id)
      ) {
        latest.set(conversation.botId, conversation);
      }
    }
    const graph = await harness.taskGraph(context);
    try {
      const executing = new Set<number>();
      for (const task of Object.values(graph.value.tasks)) {
        if (task.state.status === "running") executing.add(task.conversationId);
      }
      return await Promise.all(
        bots.map(async (bot) => {
          const summary = latest.get(bot.id);
          if (!summary)
            return { botId: bot.id, conversationId: null, latestMessage: "", executing: false };
          const conversation = await conversationById(harness, summary.id);
          const { messages } = await readProjectedMessages(storage, conversation.id);
          const text = messages.findLast((message) => message.text)?.text ?? "";
          return {
            botId: bot.id,
            conversationId: conversation.id,
            latestMessage: Array.from(text).slice(0, 160).join(""),
            executing: executing.has(conversation.id),
          };
        }),
      );
    } finally {
      graph.dispose();
    }
  }
  return { snapshot, chatHistory, botSummaries };
}

function isHistoryCursor(value: unknown): value is EncodedHistoryCursor {
  if (!isRecord(value)) return false;
  const scan = value.scan;
  if (
    value.version !== 1 ||
    !isPositiveInteger(value.anchorConversationId) ||
    typeof value.botId !== "string" ||
    !value.botId ||
    !isPositiveInteger(value.conversationId) ||
    !isRecord(scan)
  ) {
    return false;
  }
  const validEntryId = (id: unknown) => id === null || isPositiveInteger(id);
  return (
    (scan.headMarkerId === undefined || validEntryId(scan.headMarkerId)) &&
    (scan.tailId === undefined || validEntryId(scan.tailId)) &&
    (scan.minEntryId === undefined || validEntryId(scan.minEntryId)) &&
    (scan.cursor === undefined || isPiCursor(scan.cursor))
  );
}

function isPiCursor(value: unknown): value is NonNullable<ConversationHistoryScan["cursor"]> {
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
