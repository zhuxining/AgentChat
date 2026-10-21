import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
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
import { readProjectedMessages } from "./messages.js";
import { conversationById } from "./operations/index.js";
import { ConversationMetadata, type ConversationSummary } from "./product-state.js";

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
export function createViews(
  harness: Harness,
  storage: Storage,
  resolver: ReturnType<typeof createAgentResolver>,
  isConfigured: (providerId: string | undefined) => Promise<boolean> | boolean,
) {
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
  return { snapshot, botSummaries };
}
