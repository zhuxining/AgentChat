import { invoke } from "@tauri-apps/api/core";

export type Bot = {
  id: string;
  name: string;
  model: { provider: string; modelId: string };
  thinkingLevel: "minimal" | "low" | "medium" | "high" | "xhigh";
  instructions: string;
  cwd: string;
  extensions: string[];
  tools: string[];
  revision: number;
  archived: boolean;
};
export type BotDraft = Omit<Bot, "id" | "model" | "revision" | "archived"> & { modelId: string };
export type ConversationSummary = {
  id: number;
  botId: string;
  botName: string;
  botRevision: number;
  createdAt: number;
};
export type RunnerCapabilities = {
  extensions: string[];
  tools: { name: string; extension: string }[];
};
export type ProjectedMessage = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  truncated: boolean;
};
export type ConversationSnapshot = {
  conversation: {
    id: number;
    botId: string;
    botName: string;
    botRevision: number;
    agent: {
      model: { provider: string; modelId: string } | null;
      thinkingLevel: string;
      instructions: string;
      cwd: string;
      extensions: string[];
      tools: string[];
    };
  };
  goal: { description: string; status: "open" | "completed"; updatedAt: number; completedAt: number | null };
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
export type InitializeResult = {
  bots: Bot[];
  conversations: ConversationSummary[];
  capabilities: RunnerCapabilities;
  apiKeyConfigured: boolean;
  credentialWarning?: string;
  runtimeVersion: string;
};

export type RunnerRequest =
  | { op: "initialize" }
  | ({ op: "createBot" } & BotDraft)
  | ({ op: "updateBot"; botId: string } & BotDraft)
  | { op: "archiveBot"; botId: string }
  | { op: "createConversation"; botId: string; cwd: string; goal: string }
  | { op: "applyBotSettings"; conversationId: number }
  | { op: "saveGoal"; conversationId: number; description: string }
  | { op: "setGoalStatus"; conversationId: number; status: "open" | "completed" }
  | { op: "submit"; conversationId: number; text: string; requestId: string }
  | { op: "abortSubmission"; conversationId: number; submissionId: number }
  | { op: "snapshot"; conversationId: number }
  | { op: "abort"; conversationId: number };
type RunnerReply<T> = { result: T | null };

async function request<T>(message: RunnerRequest): Promise<T> {
  const reply = await invoke<RunnerReply<T>>("runner_request", { request: message });
  if (reply.result === null) throw new Error("Runner 响应缺少结果");
  return reply.result;
}

export const runnerClient = {
  initialize: () => request<InitializeResult>({ op: "initialize" }),
  createBot: (input: BotDraft) => request<Bot>({ op: "createBot", ...input }),
  updateBot: (botId: string, input: BotDraft) =>
    request<{ bot: Bot; bots: Bot[] }>({ op: "updateBot", botId, ...input }),
  archiveBot: (botId: string) => request<{ bots: Bot[] }>({ op: "archiveBot", botId }),
  createConversation: (botId: string, cwd: string, goal: string) =>
    request<ConversationSummary>({ op: "createConversation", botId, cwd, goal }),
  applyBotSettings: (conversationId: number) =>
    request<{ botRevision: number }>({ op: "applyBotSettings", conversationId }),
  saveGoal: (conversationId: number, description: string) =>
    request<ConversationSnapshot["goal"]>({ op: "saveGoal", conversationId, description }),
  setGoalStatus: (conversationId: number, status: "open" | "completed") =>
    request<ConversationSnapshot["goal"]>({ op: "setGoalStatus", conversationId, status }),
  submit: (conversationId: number, text: string, requestId: string) =>
    request<{ id: number }>({ op: "submit", conversationId, text, requestId }),
  abortSubmission: (conversationId: number, submissionId: number) =>
    request<{ status: "aborted" | "already_placed" | "settled" | "not_found" }>(
      { op: "abortSubmission", conversationId, submissionId },
    ),
  snapshot: (conversationId: number) => request<ConversationSnapshot>({ op: "snapshot", conversationId }),
  abort: (conversationId: number) => request<{ stopped: boolean }>({ op: "abort", conversationId }),
  setProviderCredential: (apiKey: string | null) =>
    invoke<{ configured: boolean; runnerUpdated: boolean }>("set_provider_credential", { apiKey }),
  restartRunner: () => invoke<void>("restart_runner"),
};
