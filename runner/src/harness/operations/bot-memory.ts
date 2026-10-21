import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";

import {
  BOT_MEMORY_MAX_CHARACTERS,
  type BotMemory,
  type SaveBotMemoryResult,
} from "../../../../contracts/bot-memory.js";
import { redactSensitiveText } from "../../../../contracts/sensitive-text.js";
import type { Configuration } from "../../config/configuration.js";
import { BotMemoryDocument } from "../extensions/bot-memory.js";
import type { Mutate } from "./mutation-queue.js";

const context = BACKGROUND_CONTEXT;
const emptyMemory = (botId: string): BotMemory => ({
  botId,
  content: "",
  revision: 0,
  source: null,
  updatedAt: null,
});

export function createBotMemoryOperations(
  harness: Harness,
  configuration: Configuration,
  mutate: Mutate,
) {
  return {
    readBotMemory: async (botId: string): Promise<BotMemory> => {
      configuration.requireBot(botId);
      const document = await harness.snapshot(BotMemoryDocument, botId, context);
      if (!document) return emptyMemory(botId);
      return {
        botId,
        content: document.content,
        revision: document.revision,
        source: document.source,
        updatedAt: document.updatedAt,
      };
    },
    saveBotMemory: (
      botId: string,
      expectedRevision: number,
      content: string,
    ): Promise<SaveBotMemoryResult> =>
      mutate(async () => {
        configuration.requireBot(botId);
        if (Array.from(content).length > BOT_MEMORY_MAX_CHARACTERS)
          throw new Error(`Bot 记忆最多 ${BOT_MEMORY_MAX_CHARACTERS} 个字符`);
        const sanitized = redactSensitiveText(content);
        let revision = 0;
        const updatedAt = Date.now();
        await harness.commit(async (tx) => {
          const document = await tx.doc(BotMemoryDocument, botId, botId);
          if (document.revision !== expectedRevision)
            throw new Error("Bot 记忆已被其他编辑更新，请重新读取后再保存。");
          revision = document.revision + 1;
          document.content = sanitized.content;
          document.revision = revision;
          document.source = "user";
          document.updatedAt = updatedAt;
        }, context);
        return {
          memory: {
            botId,
            content: sanitized.content,
            revision,
            source: "user",
            updatedAt,
          },
          redacted: sanitized.redacted,
        };
      }),
  };
}
