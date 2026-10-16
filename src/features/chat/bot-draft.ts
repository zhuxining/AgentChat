import type { Bot, BotDraft, RunnerCapabilities } from "@/app/runner-client";

export const defaultInstructions = "用简体中文回答，先给出直接结论。";

export function initializeBotDraft(bot: Bot | null, capabilities: RunnerCapabilities): BotDraft {
  if (bot) {
    return {
      name: bot.name,
      modelId: bot.model.provider === "deepseek" ? bot.model.modelId : "deepseek-chat",
      thinkingLevel: bot.thinkingLevel,
      instructions: bot.instructions,
      cwd: bot.cwd,
      extensions: [...bot.extensions],
      tools: [...bot.tools],
    };
  }
  return {
    name: "",
    modelId: "deepseek-chat",
    thinkingLevel: "medium",
    instructions: defaultInstructions,
    cwd: "",
    extensions: capabilities.extensions.includes("coding-tools") ? ["coding-tools"] : [],
    tools: capabilities.tools
      .filter((tool) => tool.extension === "coding-tools")
      .map((tool) => tool.name),
  };
}
