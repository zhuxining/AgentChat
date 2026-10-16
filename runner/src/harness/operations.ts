import { resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
  AgentDoc,
  configure,
  type Harness,
  type ConversationId,
  type SubmissionId,
} from "@earendil-works/pi-durable";

import type { Configuration } from "../config/configuration.js";
import type { createAgentResolver } from "./agent.js";
import { prepareWorkspace } from "./environment.js";
import { GoalState } from "./extensions/work-goal.js";
import {
  ConversationIndex,
  ConversationMetadata,
  type ConversationSummary,
} from "./product-state.js";

const context = BACKGROUND_CONTEXT;

export async function conversationById(harness: Harness, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("无效的执行对话 ID");
  const conversation = await harness.conversation(id as ConversationId, context);
  if (!conversation) throw new Error("执行对话不存在");
  return conversation;
}

// Serializing application mutations protects idle-only configure from racing submit.
// Harness still owns admission, queues, scheduling and execution recovery.
export function createOperations(
  harness: Harness,
  configuration: Configuration,
  models: MutableModels,
  resolver: ReturnType<typeof createAgentResolver>,
) {
  let mutationQueue = Promise.resolve();
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function idle(id: ConversationId) {
    const inspection = await harness.inspect(context);
    if (
      inspection.tasks.some((task) => task.record.conversationId === id) ||
      inspection.submissions.some(
        (item) =>
          item.conversationId === id && (item.status === "queued" || item.status === "placed"),
      )
    ) {
      throw new Error("Conversation 正在运行或有输入排队，必须等它空闲后才能应用 Bot 设置。");
    }
  }
  async function available(id: ConversationId) {
    const stored = await harness.snapshot(AgentDoc, id, context);
    const missing = resolver.missing(stored?.extensions, stored?.tools);
    if (missing.missingExtensions.length || missing.missingTools.length) {
      throw new Error(
        "执行配置引用了当前不可用的能力：" +
          [...missing.missingExtensions, ...missing.missingTools].join("、"),
      );
    }
    if (stored?.model && !models.getModel(stored.model.provider, stored.model.modelId)) {
      throw new Error("执行配置中的模型当前不可用，请显式应用可用配置。");
    }
  }
  return {
    mutate,
    conversations: async () =>
      (await harness.snapshot(ConversationIndex, context))?.conversations ?? [],
    createConversation: (input: { botId: string; cwd: string; goal: string }) =>
      mutate(async () => {
        const bot = configuration.requireBot(input.botId);
        const cwd = input.cwd ? resolve(configuration.dataDir, input.cwd) : bot.cwd;
        const agent = resolver.resolve({ ...bot, cwd });
        await prepareWorkspace(cwd);
        const createdAt = Date.now();
        const conversation = await harness.createConversation(
          {
            ownership: { kind: "ownerless" },
            agent,
            init: async (tx, id) => {
              const metadata = await tx.doc(ConversationMetadata, id);
              Object.assign(metadata, {
                botId: bot.id,
                botName: bot.name,
                botConfigVersion: bot.configVersion,
                cwdOverride: input.cwd ? cwd : null,
                createdAt,
              });
              const goal = await tx.doc(GoalState, id);
              goal.description = input.goal;
              goal.updatedAt = createdAt;
              const index = await tx.doc(ConversationIndex);
              index.conversations = [
                ...index.conversations,
                {
                  id,
                  botId: bot.id,
                  botName: bot.name,
                  botConfigVersion: bot.configVersion,
                  createdAt,
                },
              ];
            },
          },
          context,
        );
        const summary: ConversationSummary = {
          id: conversation.id,
          botId: bot.id,
          botName: bot.name,
          botConfigVersion: bot.configVersion,
          createdAt,
        };
        return summary;
      }),
    applyBotSettings: (id: number) =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        const metadata = await harness.snapshot(ConversationMetadata, conversation.id, context);
        const bot = configuration.requireBot(metadata?.botId ?? "");
        await idle(conversation.id);
        const cwd = metadata?.cwdOverride ?? bot.cwd;
        const change = resolver.resolve({ ...bot, cwd });
        await prepareWorkspace(cwd);
        await harness.commit(async (tx) => {
          await configure(tx, conversation.id, change);
          Object.assign(await tx.doc(ConversationMetadata, conversation.id), {
            botName: bot.name,
            botConfigVersion: bot.configVersion,
          });
          const index = await tx.doc(ConversationIndex);
          index.conversations = index.conversations.map((item) =>
            item.id === id
              ? {
                  ...item,
                  botName: bot.name,
                  botConfigVersion: bot.configVersion,
                }
              : item,
          );
        }, context);
        return { botConfigVersion: bot.configVersion };
      }),
    saveGoal: (id: number, description: string) =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        await harness.commit(async (tx) => {
          const goal = await tx.doc(GoalState, conversation.id);
          if (goal.description !== description) {
            goal.status = "open";
            goal.completedAt = null;
          }
          goal.description = description;
          goal.updatedAt = Date.now();
        }, context);
        return harness.snapshot(GoalState, conversation.id, context);
      }),
    setGoalStatus: (id: number, status: "open" | "completed") =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        await harness.commit(async (tx) => {
          const goal = await tx.doc(GoalState, conversation.id);
          if (!goal.description.trim()) throw new Error("请先保存工作目标描述");
          const now = Date.now();
          goal.status = status;
          goal.updatedAt = now;
          goal.completedAt = status === "completed" ? now : null;
        }, context);
        return harness.snapshot(GoalState, conversation.id, context);
      }),
    submit: (input: { conversationId: number; text: string; requestId: string }) =>
      mutate(async () => {
        const conversation = await conversationById(harness, input.conversationId);
        await available(conversation.id);
        const submission = await conversation.submit(
          { type: "input", content: input.text, requestId: input.requestId },
          context,
        );
        return { id: submission.id };
      }),
    abortSubmission: (id: number, submissionId: number) =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        return {
          status: await harness.abortSubmission(
            submissionId as SubmissionId,
            context,
            conversation.id,
          ),
        };
      }),
    abort: (id: number) =>
      mutate(async () => {
        await (await conversationById(harness, id)).abort(context);
        return { stopped: true };
      }),
  };
}
