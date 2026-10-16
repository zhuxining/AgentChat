import type { AgentState, HarnessSettings, ModelRef } from "@earendil-works/pi-durable";

export type ThinkingLevel = Exclude<NonNullable<AgentState["thinkingLevel"]>, "max">;
export type AgentConfiguration = {
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  instructions?: string;
  instructionsFile?: string;
  extensions: string[];
  tools: string[];
};
export type RunnerConfiguration = {
  schemaVersion: 1;
  name: string;
  workspace: { root: string };
  providers: Record<string, { type: "deepseek"; credentialRef: string }>;
  botDefaults: Omit<AgentConfiguration, "instructionsFile"> & { instructions: string };
  harness: Pick<
    HarnessSettings,
    "toolExecution" | "followUpMode" | "steeringMode" | "stream" | "retry" | "compaction"
  >;
};
export type BotConfiguration = {
  schemaVersion: 1;
  name: string;
  archived: boolean;
  workspace: { path: string };
  agent: AgentConfiguration;
};
/** Flat projection for UI and execution configuration; JSON remains the authority. */
export type Bot = {
  id: string;
  name: string;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  instructions: string;
  cwd: string;
  extensions: string[];
  tools: string[];
  archived: boolean;
  configVersion: string;
};
export type ResolvedBot = Bot;
export type ConfigurationError = { path: string; message: string; botId?: string };
export type ConfigurationFile = { path: string; content: string; version: string };

export class ConfigurationFailure extends Error {}
function invalid(field: string): never {
  throw new ConfigurationFailure(`配置字段 ${field} 无效`);
}
function object(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const record = value as Record<string, unknown>;
  // Never echo an unknown key or user-supplied value: either could contain a credential.
  if (Object.keys(record).some((key) => !fields.includes(key))) {
    throw new ConfigurationFailure(`配置 ${field} 含未知字段`);
  }
  return record;
}
function text(value: unknown, field: string, max = 2000, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    value.includes("\0") ||
    (!empty && !value.trim())
  )
    invalid(field);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}
function integer(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) invalid(field);
  return value;
}
function names(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) invalid(field);
  const result = value.map((item) => text(item, field, 120));
  if (new Set(result).size !== result.length) invalid(field);
  return result;
}
function choice<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) invalid(field);
  return value as T;
}
export function safeBotId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id)) invalid("botId");
  return id;
}
function model(value: unknown): ModelRef {
  const input = object(value, ["provider", "modelId"], "model");
  return {
    provider: text(input.provider, "model.provider", 120),
    modelId: text(input.modelId, "model.modelId", 120),
  };
}
function agent(value: unknown, defaults = false): AgentConfiguration {
  const input = object(
    value,
    defaults
      ? ["model", "thinkingLevel", "instructions", "extensions", "tools"]
      : ["model", "thinkingLevel", "instructions", "instructionsFile", "extensions", "tools"],
    "agent",
  );
  if ((input.instructions === undefined) === (input.instructionsFile === undefined))
    invalid("agent.instructions/instructionsFile");
  return {
    model: model(input.model),
    thinkingLevel: choice(
      input.thinkingLevel,
      ["minimal", "low", "medium", "high", "xhigh"],
      "agent.thinkingLevel",
    ),
    ...(input.instructions === undefined
      ? { instructionsFile: text(input.instructionsFile, "agent.instructionsFile") }
      : { instructions: text(input.instructions, "agent.instructions", 128_000, true) }),
    extensions: names(input.extensions, "agent.extensions"),
    tools: names(input.tools, "agent.tools"),
  };
}
function settings(value: unknown): RunnerConfiguration["harness"] {
  const input = object(
    value,
    ["toolExecution", "followUpMode", "steeringMode", "stream", "retry", "compaction"],
    "harness",
  );
  const result: RunnerConfiguration["harness"] = {};
  // Build mutable locals since the library correctly exposes readonly HarnessSettings.
  const toolExecution =
    input.toolExecution === undefined
      ? undefined
      : choice(input.toolExecution, ["parallel", "sequential"], "harness.toolExecution");
  const followUpMode =
    input.followUpMode === undefined
      ? undefined
      : choice(input.followUpMode, ["all", "one-at-a-time"], "harness.followUpMode");
  const steeringMode =
    input.steeringMode === undefined
      ? undefined
      : choice(input.steeringMode, ["all", "one-at-a-time"], "harness.steeringMode");
  const stream: NonNullable<HarnessSettings["stream"]> = {};
  if (input.stream !== undefined) {
    const raw = object(input.stream, ["timeoutMs", "maxRetries"], "harness.stream");
    if (raw.timeoutMs !== undefined)
      stream.timeoutMs = integer(raw.timeoutMs, "harness.stream.timeoutMs", 1);
    if (raw.maxRetries !== undefined)
      stream.maxRetries = integer(raw.maxRetries, "harness.stream.maxRetries");
  }
  const retry: NonNullable<HarnessSettings["retry"]> = {};
  if (input.retry !== undefined) {
    const raw = object(input.retry, ["enabled", "maxRetries", "baseDelayMs"], "harness.retry");
    if (raw.enabled !== undefined) retry.enabled = boolean(raw.enabled, "harness.retry.enabled");
    if (raw.maxRetries !== undefined)
      retry.maxRetries = integer(raw.maxRetries, "harness.retry.maxRetries");
    if (raw.baseDelayMs !== undefined)
      retry.baseDelayMs = integer(raw.baseDelayMs, "harness.retry.baseDelayMs");
  }
  const compaction: NonNullable<HarnessSettings["compaction"]> = {};
  if (input.compaction !== undefined) {
    const raw = object(
      input.compaction,
      ["enabled", "reserveTokens", "keepRecentTokens", "backgroundTokens"],
      "harness.compaction",
    );
    if (raw.enabled !== undefined)
      compaction.enabled = boolean(raw.enabled, "harness.compaction.enabled");
    if (raw.reserveTokens !== undefined)
      compaction.reserveTokens = integer(raw.reserveTokens, "harness.compaction.reserveTokens");
    if (raw.keepRecentTokens !== undefined)
      compaction.keepRecentTokens = integer(
        raw.keepRecentTokens,
        "harness.compaction.keepRecentTokens",
      );
    if (raw.backgroundTokens !== undefined)
      compaction.backgroundTokens = integer(
        raw.backgroundTokens,
        "harness.compaction.backgroundTokens",
      );
  }
  return {
    ...result,
    ...(toolExecution === undefined ? {} : { toolExecution }),
    ...(followUpMode === undefined ? {} : { followUpMode }),
    ...(steeringMode === undefined ? {} : { steeringMode }),
    ...(input.stream === undefined ? {} : { stream }),
    ...(input.retry === undefined ? {} : { retry }),
    ...(input.compaction === undefined ? {} : { compaction }),
  };
}
export function parseJSON(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ConfigurationFailure("配置 JSON 语法无效");
  }
}
export function parseRunner(value: unknown): RunnerConfiguration {
  const input = object(
    value,
    ["schemaVersion", "name", "workspace", "providers", "botDefaults", "harness"],
    "runner",
  );
  if (input.schemaVersion !== 1) invalid("schemaVersion");
  const workspace = object(input.workspace, ["root"], "workspace");
  const providerInput = input.providers;
  if (!providerInput || typeof providerInput !== "object" || Array.isArray(providerInput))
    invalid("providers");
  const providers: RunnerConfiguration["providers"] = {};
  for (const [id, value] of Object.entries(providerInput)) {
    if (id !== "deepseek") invalid("providers.id");
    const provider = object(value, ["type", "credentialRef"], "providers");
    if (provider.type !== "deepseek") invalid("providers.type");
    if (provider.credentialRef !== "provider/deepseek") invalid("providers.credentialRef");
    Object.defineProperty(providers, id, {
      enumerable: true,
      writable: true,
      configurable: true,
      value: {
        type: "deepseek",
        credentialRef: text(provider.credentialRef, "providers.credentialRef", 200),
      },
    });
  }
  const defaults = agent(input.botDefaults, true);
  if (defaults.instructions === undefined) invalid("botDefaults.instructions");
  return {
    schemaVersion: 1,
    name: text(input.name, "name", 80),
    workspace: { root: text(workspace.root, "workspace.root") },
    providers,
    botDefaults: { ...defaults, instructions: defaults.instructions },
    harness: input.harness === undefined ? {} : settings(input.harness),
  };
}
export function parseBot(value: unknown): BotConfiguration {
  const input = object(value, ["schemaVersion", "name", "archived", "workspace", "agent"], "bot");
  if (input.schemaVersion !== 1) invalid("schemaVersion");
  const workspace = object(input.workspace, ["path"], "workspace");
  return {
    schemaVersion: 1,
    name: text(input.name, "name", 80),
    archived: boolean(input.archived, "archived"),
    workspace: { path: text(workspace.path, "workspace.path") },
    agent: agent(input.agent),
  };
}
export function defaultRunnerConfiguration(): RunnerConfiguration {
  return {
    schemaVersion: 1,
    name: "本机 Runner",
    workspace: { root: "workspaces" },
    providers: { deepseek: { type: "deepseek", credentialRef: "provider/deepseek" } },
    botDefaults: {
      model: { provider: "deepseek", modelId: "deepseek-chat" },
      thinkingLevel: "medium",
      instructions: "",
      extensions: ["coding-tools"],
      tools: ["bash", "edit", "read", "write"],
    },
    harness: {},
  };
}
