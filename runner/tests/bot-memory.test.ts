import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  Harness,
  MemoryStorage,
  type Conversation,
} from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { BOT_MEMORY_MAX_CHARACTERS } from "../../contracts/bot-memory.js";
import { Configuration } from "../src/config/configuration.js";
import { botMemoryExtension } from "../src/harness/extensions/bot-memory.js";
import { createBotMemoryOperations } from "../src/harness/operations/bot-memory.js";
import { createMutationQueue } from "../src/harness/operations/mutation-queue.js";
import { ConversationMetadata } from "../src/harness/product-state.js";

const context = BACKGROUND_CONTEXT;
const directories: string[] = [];
type Fixture = {
  bot: ReturnType<Configuration["requireBot"]>;
  otherBot: ReturnType<Configuration["requireBot"]>;
  harness: Harness;
  operations: ReturnType<typeof createBotMemoryOperations>;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => {
      await chmod(path, 0o700).catch(() => undefined);
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function withFixture<T>(run: (fixture: Fixture) => Promise<T>) {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), "agentchat-bot-memory-")));
  directories.push(dataDir);
  const configuration = await Configuration.open(dataDir);
  const bot = await configuration.createBot({ name: "记忆助手" });
  const otherBot = await configuration.createBot({ name: "另一个助手" });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context,
  );
  const operations = createBotMemoryOperations(harness, configuration, createMutationQueue());
  try {
    return await run({ bot, otherBot, harness, operations });
  } finally {
    await harness.close(context);
  }
}

async function conversationFor(harness: Harness, botId: string) {
  return harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      init: async (tx, id) => {
        const metadata = await tx.doc(ConversationMetadata, id);
        metadata.botId = botId;
      },
    },
    context,
  );
}

async function renderMemory(harness: Harness, conversation: Conversation) {
  const section = botMemoryExtension.sections?.[0];
  if (!section) throw new Error("Bot memory section was not registered");
  return section.render(
    {
      conversationId: conversation.id,
      agent: await conversation.agent(context),
      env: undefined,
      shown: {},
      read: harness,
    },
    context,
  );
}

describe("Bot memory", () => {
  it("shares a Bot's memory across its conversations and keeps other Bots isolated", async () => {
    await withFixture(async ({ bot, otherBot, harness, operations }) => {
      await operations.saveBotMemory(bot.id, 0, "使用简体中文回复。");
      const firstConversation = await conversationFor(harness, bot.id);
      const secondConversation = await conversationFor(harness, bot.id);
      const otherConversation = await conversationFor(harness, otherBot.id);

      expect(await operations.readBotMemory(bot.id)).toEqual(
        expect.objectContaining({
          botId: bot.id,
          content: "使用简体中文回复。",
          revision: 1,
          source: "user",
        }),
      );
      expect(await renderMemory(harness, firstConversation)).toContain("使用简体中文回复。");
      expect(await renderMemory(harness, secondConversation)).toContain("使用简体中文回复。");
      expect(await renderMemory(harness, otherConversation)).toBeUndefined();
    });
  });

  it("rejects stale revisions and clears the injected context by saving an empty revision", async () => {
    await withFixture(async ({ bot, harness, operations }) => {
      const conversation = await conversationFor(harness, bot.id);
      await operations.saveBotMemory(bot.id, 0, "保留项目决策。");

      await expect(operations.saveBotMemory(bot.id, 0, "过期草稿。")).rejects.toThrow(
        "Bot 记忆已被其他编辑更新",
      );
      const cleared = await operations.saveBotMemory(bot.id, 1, "");

      expect(cleared.memory).toEqual(
        expect.objectContaining({ content: "", revision: 2, source: "user" }),
      );
      expect(await renderMemory(harness, conversation)).toBeUndefined();
    });
  });

  it("redacts common credential formats and counts Unicode code points for the size limit", async () => {
    await withFixture(async ({ bot, operations }) => {
      const saved = await operations.saveBotMemory(
        bot.id,
        0,
        'Use Bearer abc.def-123, api_key="sk-abcdefghijklmnop", token: ghp_abcdefghijklmnopqrstuvwx, password=hunter2',
      );

      expect(saved.redacted).toBe(true);
      expect(saved.memory.content).toContain("Bearer *");
      expect(saved.memory.content).toContain('api_key="*"');
      expect(saved.memory.content).not.toContain("abc.def-123");
      expect(saved.memory.content).not.toContain("ghp_abcdefghijklmnopqrstuvwx");
      expect(saved.memory.content).not.toContain("hunter2");

      const maximum = "😀".repeat(BOT_MEMORY_MAX_CHARACTERS);
      await operations.saveBotMemory(bot.id, 1, maximum);
      await expect(operations.saveBotMemory(bot.id, 2, `${maximum}😀`)).rejects.toThrow(
        `Bot 记忆最多 ${BOT_MEMORY_MAX_CHARACTERS} 个字符`,
      );
    });
  });
});
