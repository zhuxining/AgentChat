import type { MutableModels } from "@earendil-works/pi-ai/models";
import type { AgentChange, ModelRef, Registry } from "@earendil-works/pi-durable";

import { workGoalExtension } from "./extensions/work-goal.js";

type AgentConfiguration = {
  model: ModelRef;
  thinkingLevel: NonNullable<AgentChange["thinkingLevel"]>;
  instructions: string;
  cwd: string;
  extensions: string[];
  tools: string[];
};

export function createAgentResolver(models: MutableModels, registry: Registry) {
  function resolve(configuration: AgentConfiguration): AgentChange {
    const model = models.getModel(configuration.model.provider, configuration.model.modelId);
    if (!model)
      throw new Error(
        "模型「" +
          configuration.model.provider +
          "/" +
          configuration.model.modelId +
          "」当前不可用",
      );
    const available = registry.snapshot();
    const extensions = [
      workGoalExtension,
      ...configuration.extensions.map((name) => {
        if (name === workGoalExtension.name)
          throw new Error("Extension「" + name + "」由 AgentChat 管理");
        const extension = available.installed().find((item) => item.name === name);
        if (!extension) throw new Error("Extension「" + name + "」当前不可用");
        return extension;
      }),
    ];
    const selected = new Set(extensions.map((extension) => extension.name));
    const tools = configuration.tools.map((name) => {
      const registration = available.tools().find((item) => item.tool.name === name);
      if (!registration || !selected.has(registration.extension.name)) {
        throw new Error("Tool「" + name + "」当前不可用或所属 Extension 未启用");
      }
      return registration.tool;
    });
    return {
      model: configuration.model,
      thinkingLevel: configuration.thinkingLevel,
      instructions: configuration.instructions || null,
      cwd: configuration.cwd,
      extensions,
      tools,
    };
  }
  function missing(extensions: unknown, tools: unknown) {
    const available = registry.snapshot();
    return {
      missingExtensions: names(extensions).filter(
        (name) => !available.installed().some((item) => item.name === name),
      ),
      missingTools: names(tools).filter(
        (name) => !available.tools().some((item) => item.tool.name === name),
      ),
    };
  }
  return { resolve, missing };
}

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
