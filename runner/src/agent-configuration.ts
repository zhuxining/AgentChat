import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  defineExtension,
  section,
  type AgentChange,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";

import type { Bot } from "./bot.js";
import { GoalDoc } from "./documents.js";

const toolDefinitions = [createBashTool(), createEditTool(), createReadTool(), createWriteTool()];
export const defaultToolNames = toolDefinitions.map((tool) => tool.name);

export const workGoalExtension = defineExtension({
  name: "agentchat-work-goal",
  sections: [
    section("work-goal", async ({ conversationId, read }, renderContext) => {
      const goal = await read.snapshot(GoalDoc, conversationId, renderContext);
      if (!goal?.description.trim()) return undefined;
      const status =
        goal.status === "completed"
          ? "The user explicitly marked this goal complete. Do not claim a different completion state; handle new requests normally."
          : "The goal remains open until the user explicitly marks it complete. Ending a run or task does not complete it.";
      return `${goal.description}\n\nGoal status: ${status}`;
    }),
  ],
});
export const codingToolsExtension = defineExtension({
  name: "coding-tools",
  tools: toolDefinitions,
});

export function createAgentConfiguration(models: MutableModels) {
  const registry = createRegistry();
  registry.install(workGoalExtension);
  registry.install(codingToolsExtension);
  const extensionByName = new Map<string, Extension>(
    registry
      .snapshot()
      .installed()
      .map((extension) => [extension.name, extension]),
  );
  const toolByName = new Map<string, ToolRegistration>(
    toolDefinitions.map((tool) => [tool.name, tool]),
  );
  const toolExtensionByName = new Map<string, string>(
    toolDefinitions.map((tool) => [tool.name, codingToolsExtension.name]),
  );
  function resolveAgentChange(bot: Bot): AgentChange {
    if (!models.getModel(bot.model.provider, bot.model.modelId)) {
      throw new Error(`模型「${bot.model.provider}/${bot.model.modelId}」当前不可用`);
    }
    const selectedExtensions = [
      workGoalExtension,
      ...bot.extensions.map((name) => {
        if (name === workGoalExtension.name)
          throw new Error(`Extension「${name}」由 AgentChat 管理`);
        const extension = extensionByName.get(name);
        if (!extension) throw new Error(`Bot 选择的 Extension「${name}」当前不可用`);
        return extension;
      }),
    ];
    const selectedExtensionNames = new Set(selectedExtensions.map((extension) => extension.name));
    const selectedTools = bot.tools.map((name) => {
      const tool = toolByName.get(name);
      if (!tool) throw new Error(`Bot 选择的 Tool「${name}」当前不可用`);
      const owner = toolExtensionByName.get(name);
      if (!owner || !selectedExtensionNames.has(owner)) {
        throw new Error(`Tool「${name}」所属的 Extension 未启用`);
      }
      return tool;
    });
    return {
      model: bot.model,
      thinkingLevel: bot.thinkingLevel,
      instructions: bot.instructions || null,
      cwd: bot.cwd || null,
      extensions: selectedExtensions,
      tools: selectedTools,
    };
  }

  return {
    registry,
    resolveAgentChange,
    missingConfiguration: (extensions: unknown, tools: unknown) => {
      const missingExtensions = configuredNames(extensions).filter(
        (name) => !extensionByName.has(name),
      );
      const missingTools = configuredNames(tools).filter((name) => !toolByName.has(name));
      return { missingExtensions, missingTools };
    },
  };
}

function configuredNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((name): name is string => typeof name === "string");
  if (value && typeof value === "object" && "add" in value) {
    const add = (value as { add?: unknown }).add;
    if (Array.isArray(add)) return add.filter((name): name is string => typeof name === "string");
  }
  return [];
}
