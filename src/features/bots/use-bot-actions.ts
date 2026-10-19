import { useQueryClient } from "@tanstack/react-query";

import type { Bot, BotDraft } from "@/app/runner-client";
import { useCatalogCache, errorMessage, captureRunnerSession } from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useWorkspaceResources } from "@/app/workspace-provider";
import { useRouteBotId } from "@/features/bots/bot-queries";

export function useBotActions() {
  const { client, drafts } = useWorkspaceResources();
  const cache = useQueryClient();
  const updateCatalog = useCatalogCache();
  const botId = useRouteBotId();
  const operation = useOperation(["bots", botId]);

  async function openConversation(
    botId: string,
    cwd: string,
    goal: string,
    assertCurrent: () => void,
  ) {
    assertCurrent();
    const created = await client.createConversation(botId, cwd, goal);
    assertCurrent();
    updateCatalog((current) => ({
      ...current,
      conversations: [...current.conversations, created],
    }));
    return true;
  }

  function saveBot(botId: string | null, draft: BotDraft, configVersion?: string) {
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      if (botId) {
        if (!configVersion) throw new Error("缺少配置版本，请重新打开 Bot 编辑页。");
        const result = await client.updateBot(botId, draft, configVersion);
        assertCurrent();
        updateCatalog((current) => ({ ...current, bots: result.bots }));
        return result.bot;
      }
      const bot = await client.createBot(draft);
      assertCurrent();
      updateCatalog((current) => ({ ...current, bots: [...current.bots, bot] }));
      try {
        await openConversation(bot.id, "", "", assertCurrent);
      } catch (cause) {
        drafts.setState((state) => ({
          errors: {
            ...state.errors,
            [bot.id]: `Bot 已创建，但打开聊天失败：${errorMessage(cause)}。可以点击“开始新对话”重试。`,
          },
        }));
      }
      return bot;
    });
  }

  function archiveBot(bot: Bot) {
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      const result = await client.archiveBot(bot.id, bot.configVersion);
      assertCurrent();
      updateCatalog((current) => ({ ...current, bots: result.bots }));
      return true;
    });
  }

  function startConversation(botId: string, cwd = "", goal = "") {
    return operation.runAction(async () => {
      const result = await openConversation(botId, cwd, goal, captureRunnerSession(cache));
      drafts.setState((state) => ({ errors: { ...state.errors, [botId]: "" } }));
      return result;
    });
  }

  return { ...operation, saveBot, archiveBot, startConversation };
}
