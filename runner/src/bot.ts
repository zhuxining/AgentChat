import type { AgentState, ModelRef } from "@earendil-works/pi-durable";

import { codingToolsExtension, defaultToolNames } from "./agent-configuration.js";

export type Bot = {
  id: string;
  name: string;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  instructions: string;
  cwd: string;
  extensions: string[];
  tools: string[];
  revision: number;
  archived: boolean;
};
type ThinkingLevel = Exclude<NonNullable<AgentState["thinkingLevel"]>, "max">;
const thinkingLevels: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];

export function normalizeBot(bot: Bot): Bot {
  return {
    ...bot,
    thinkingLevel: thinkingLevels.includes(bot.thinkingLevel) ? bot.thinkingLevel : "medium",
    extensions: Array.isArray(bot.extensions)
      ? bot.extensions.filter((name) => typeof name === "string")
      : [codingToolsExtension.name],
    tools: Array.isArray(bot.tools)
      ? bot.tools.filter((name) => typeof name === "string")
      : defaultToolNames,
    revision: Number.isSafeInteger(bot.revision) && bot.revision > 0 ? bot.revision : 1,
    archived: bot.archived === true,
  };
}

export function parseBot(
  input: Record<string, unknown>,
  base: Pick<Bot, "id" | "revision" | "archived">,
): Bot {
  const name = stringField(input, "name", 80);
  const modelId = stringField(input, "modelId", 120);
  const instructions = stringField(input, "instructions", 8_000, true);
  const cwd = stringField(input, "cwd", 2_000, true);
  const thinkingLevel = stringField(input, "thinkingLevel", 16) as ThinkingLevel;
  if (!thinkingLevels.includes(thinkingLevel)) throw new Error("Thinking Level 无效");
  const extensions = stringArrayField(input, "extensions", 30);
  const tools = stringArrayField(input, "tools", 100);
  if (new Set(extensions).size !== extensions.length || new Set(tools).size !== tools.length) {
    throw new Error("Extension 或 Tool 不能重复");
  }
  return {
    ...base,
    name,
    model: { provider: "deepseek", modelId },
    thinkingLevel,
    instructions,
    cwd,
    extensions,
    tools,
  };
}

export function stringField(
  input: Record<string, unknown>,
  name: string,
  maxLength: number,
  optional = false,
): string {
  const value = input[name];
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`字段 ${name} 无效`);
  if (!optional && value.trim().length === 0) throw new Error(`字段 ${name} 不能为空`);
  return value.trim();
}

function stringArrayField(
  input: Record<string, unknown>,
  name: string,
  maxItems: number,
): string[] {
  const value = input[name];
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`字段 ${name} 无效`);
  }
  const values = value.map((item) => (item as string).trim());
  if (values.some((item) => item.length === 0 || item.length > 120))
    throw new Error(`字段 ${name} 无效`);
  return values;
}

export function numberField(input: Record<string, unknown>, name: string): number {
  const value = input[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`字段 ${name} 无效`);
  }
  return value;
}
