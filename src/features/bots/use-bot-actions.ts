import { useQueryClient } from "@tanstack/react-query";

import type { Bot, BotDraft } from "@/app/runner-client";
import { useCatalogCache, captureRunnerSession } from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useWorkspaceResources } from "@/app/workspace-provider";
import { useRouteBotId } from "@/features/bots/bot-queries";

export function useBotActions() {
  const { client } = useWorkspaceResources();
  const cache = useQueryClient();
  const updateCatalog = useCatalogCache();
  const botId = useRouteBotId();
  const operation = useOperation(["bots", botId]);

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

  return { ...operation, saveBot, archiveBot };
}
