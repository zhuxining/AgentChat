import { resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { configure, type Harness } from "@earendil-works/pi-durable";

import type { Configuration } from "../../config/configuration.js";
import type { createAgentResolver } from "../agent.js";
import { prepareWorkspace } from "../environment.js";
import { GoalState } from "../extensions/work-goal.js";
import {
  ConversationIndex,
  ConversationMetadata,
  type ConversationSummary,
} from "../product-state.js";
import type { Mutate } from "./mutation-queue.js";
import { conversationById, requireIdle } from "./shared.js";

const context = BACKGROUND_CONTEXT;

// Conversation 生命周期：创建（含元数据与初始工作目标）与 Bot 配置应用。
export function createConversationOperations(
  harness: Harness,
  configuration: Configuration,
  resolver: ReturnType<typeof createAgentResolver>,
  mutate: Mutate,
) {
  return {
    conversations: async (): Promise<ConversationSummary[]> =>
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
        await requireIdle(harness, conversation.id);
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
  };
}
