import { invoke } from "@tauri-apps/api/core";

import type { BotMemory, SaveBotMemoryResult } from "../../contracts/bot-memory";
import type { ProviderRequest, ProviderResponse } from "../../contracts/providers";
export type { ProviderInstance, ProviderModel, Json } from "../../contracts/providers";

export type RuntimeStatus = {
  status: "ready" | "missing" | "incompatible" | "error";
  path: string | null;
  version: string | null;
  source: "configured" | "path" | "system" | "managed" | null;
  architecture: string | null;
  detail: string | null;
};

export type Bot = {
  id: string;
  name: string;
  model: { provider: string; modelId: string };
  thinkingLevel: "minimal" | "low" | "medium" | "high" | "xhigh";
  instructions: string;
  cwd: string;
  extensions: string[];
  tools: string[];
  archived: boolean;
  configVersion: string;
};
export type BotDraft = Omit<Bot, "id" | "model" | "archived" | "configVersion"> & {
  provider: string;
  modelId: string;
};
export type BotDefaults = Omit<BotDraft, "name">;
export type ConversationSummary = {
  id: number;
  botId: string;
  botName: string;
  botConfigVersion: string;
  createdAt: number;
};
export type BotListSummary = {
  botId: string;
  conversationId: number | null;
  latestMessage: string;
  executing: boolean;
};
export type AttachmentReference = { id: string; name: string };
export type DraftAttachment = AttachmentReference & {
  size: number;
  mimeType: string;
  kind: "text" | "image";
};
export type SubmissionResult = { id: number } | { rejected: true; message: string };
export type RunnerCapabilities = {
  extensions: string[];
  tools: { name: string; extension: string; displayName?: string }[];
};
export type McpServerStatus = {
  id: string;
  name: string;
  status: "connecting" | "connected" | "failed";
  toolCount: number;
  skippedToolCount: number;
  message?: string;
};
export type QueryCapabilities = { botSummaries: boolean; attachments?: boolean };
export type ProjectedMessage = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  truncated: boolean;
};
export type ChatHistoryMessage = {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  text: string;
};
export type ChatHistoryPage = {
  messages: ChatHistoryMessage[];
  cursor: string | null;
};
export type ConversationUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
  models: ModelUsageSummary[];
};
export type ModelUsageSummary = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
};
export type ConversationSnapshot = {
  conversation: {
    id: number;
    botId: string;
    botName: string;
    botConfigVersion: string;
    agent: {
      model: { provider: string; modelId: string } | null;
      thinkingLevel: string;
      instructions: string;
      cwd: string;
      extensions: string[];
      tools: string[];
    };
  };
  goal: {
    description: string;
    status: "open" | "completed";
    updatedAt: number;
    completedAt: number | null;
  };
  /** Absent when an older background Runner is serving this request. */
  usage?: ConversationUsage;
  messages: ProjectedMessage[];
  hasMoreMessages: boolean;
  activeTasks: {
    id: number;
    kind: string;
    status: string;
    phase: string;
    owner: number | null;
    background: boolean;
    abortRequested: boolean;
  }[];
  submissions: { id: number; type: "input" | "write"; status: string }[];
  configurationErrors: { missingExtensions: string[]; missingTools: string[] };
  apiKeyConfigured: boolean;
};
export type ConfigurationStatus = {
  errors: { path: string; message: string; botId?: string }[];
  restartRequired: boolean;
  dataDir: string;
  files: string[];
  ready: boolean;
};
export type ConfigurationFile = { path: string; version: string; content: string };
export type ProviderOption = { name: string; label?: string; models: string[] };
export type InitializeResult = {
  bots: Bot[];
  botDefaults: BotDefaults | null;
  configuration: ConfigurationStatus;
  conversations: ConversationSummary[];
  capabilities: RunnerCapabilities;
  queryCapabilities?: QueryCapabilities;
  /** Absent when an older background Runner is serving this request. */
  mcpServers?: McpServerStatus[];
  // Absent while an older background Runner is still serving; the UI falls back to the
  // Bot's current provider and model in that case.
  providers?: ProviderOption[];
  apiKeyConfigured: boolean;
  credentialWarning?: string;
  runtimeVersion: string;
};

export type RunnerRequest =
  | { op: "providerRequest"; request: ProviderRequest }
  | { op: "initialize" }
  | { op: "mcpStatuses" }
  | { op: "reloadConfiguration" }
  | { op: "readConfiguration"; path: string }
  | { op: "saveConfiguration"; path: string; version: string; content: string }
  | ({ op: "createBot" } & BotDraft)
  | ({ op: "updateBot"; botId: string; configVersion: string } & BotDraft)
  | { op: "archiveBot"; botId: string; configVersion: string }
  | { op: "readBotMemory"; botId: string }
  | { op: "saveBotMemory"; botId: string; expectedRevision: number; content: string }
  | { op: "createConversation"; botId: string; cwd: string; goal: string }
  | { op: "applyBotSettings"; conversationId: number }
  | { op: "saveGoal"; conversationId: number; description: string }
  | { op: "setGoalStatus"; conversationId: number; status: "open" | "completed" }
  | { op: "abortSubmission"; conversationId: number; submissionId: number }
  | { op: "snapshot"; conversationId: number }
  | { op: "chatHistory"; conversationId: number; cursor: string | null }
  | { op: "botSummaries" }
  | { op: "abort"; conversationId: number };
type RunnerReply<T> = { result: T | null };

async function request<T>(message: RunnerRequest): Promise<T> {
  const reply = await invoke<RunnerReply<T>>("runner_request", { request: message });
  if (reply.result === null) throw new Error("Runner 响应缺少结果");
  return reply.result;
}

export const runnerClient = {
  providerRequest: (input: ProviderRequest) =>
    request<ProviderResponse>({ op: "providerRequest", request: input }),
  runtimeStatus: () => invoke<RuntimeStatus>("runtime_status"),
  installRuntime: () => invoke<RuntimeStatus>("install_runtime"),
  initialize: () => request<InitializeResult>({ op: "initialize" }),
  mcpStatuses: () => request<McpServerStatus[]>({ op: "mcpStatuses" }),
  reloadConfiguration: () => request<InitializeResult>({ op: "reloadConfiguration" }),
  readConfiguration: (path: string) =>
    request<ConfigurationFile>({ op: "readConfiguration", path }),
  saveConfiguration: (path: string, version: string, content: string) =>
    request<{ saved: boolean }>({ op: "saveConfiguration", path, version, content }),
  createBot: (input: BotDraft) => request<Bot>({ op: "createBot", ...input }),
  updateBot: (botId: string, input: BotDraft, configVersion: string) =>
    request<{ bot: Bot; bots: Bot[] }>({ op: "updateBot", botId, ...input, configVersion }),
  archiveBot: (botId: string, configVersion: string) =>
    request<{ bots: Bot[] }>({ op: "archiveBot", botId, configVersion }),
  readBotMemory: (botId: string) => request<BotMemory>({ op: "readBotMemory", botId }),
  saveBotMemory: (botId: string, expectedRevision: number, content: string) =>
    request<SaveBotMemoryResult>({ op: "saveBotMemory", botId, expectedRevision, content }),
  createConversation: (botId: string, cwd: string, goal: string) =>
    request<ConversationSummary>({ op: "createConversation", botId, cwd, goal }),
  applyBotSettings: (conversationId: number) =>
    request<{ botConfigVersion: string }>({ op: "applyBotSettings", conversationId }),
  saveGoal: (conversationId: number, description: string) =>
    request<ConversationSnapshot["goal"]>({ op: "saveGoal", conversationId, description }),
  setGoalStatus: (conversationId: number, status: "open" | "completed") =>
    request<ConversationSnapshot["goal"]>({ op: "setGoalStatus", conversationId, status }),
  pickAttachments: (remaining: number) =>
    invoke<DraftAttachment[]>("pick_attachments", { remaining }),
  deleteAttachments: (ids: string[]) => invoke<void>("delete_attachments", { ids }),
  submit: async (
    conversationId: number,
    text: string,
    requestId: string,
    attachments: AttachmentReference[],
  ) => {
    const reply = await invoke<RunnerReply<SubmissionResult>>("submit_with_attachments", {
      conversationId,
      text,
      requestId,
      attachments,
    });
    if (reply.result === null) throw new Error("Runner 响应缺少结果");
    return reply.result;
  },
  abortSubmission: (conversationId: number, submissionId: number) =>
    request<{ status: "aborted" | "already_placed" | "settled" | "not_found" }>({
      op: "abortSubmission",
      conversationId,
      submissionId,
    }),
  snapshot: (conversationId: number) =>
    request<ConversationSnapshot>({ op: "snapshot", conversationId }),
  chatHistory: (conversationId: number, cursor: string | null) =>
    request<ChatHistoryPage>({ op: "chatHistory", conversationId, cursor }),
  botSummaries: () => request<BotListSummary[]>({ op: "botSummaries" }),
  abort: (conversationId: number) => request<{ stopped: boolean }>({ op: "abort", conversationId }),
  startRunner: () => invoke<void>("start_runner"),
  stopRunner: () => invoke<void>("stop_runner"),
  restartRunner: () => invoke<void>("restart_runner"),
};
