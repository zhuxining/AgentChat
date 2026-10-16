import type { Bot, BotDefaults, BotDraft } from "@/app/runner-client";

export function initializeBotDraft(bot: Bot | null, defaults: BotDefaults): BotDraft {
  if (bot) {
    return {
      name: bot.name,
      provider: bot.model.provider,
      modelId: bot.model.modelId,
      thinkingLevel: bot.thinkingLevel,
      instructions: bot.instructions,
      cwd: bot.cwd,
      extensions: [...bot.extensions],
      tools: [...bot.tools],
    };
  }
  return {
    ...defaults,
    name: "",
    extensions: [...defaults.extensions],
    tools: [...defaults.tools],
  };
}
