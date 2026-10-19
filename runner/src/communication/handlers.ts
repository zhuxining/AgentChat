import type { Bot } from "../config/configuration.js";
import type { Runner } from "../harness/open.js";

function text(input: Record<string, unknown>, name: string, max = 8_000, empty = false): string {
  const value = input[name];
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) {
    throw new Error("字段 " + name + " 无效");
  }
  return value;
}
function id(input: Record<string, unknown>, name: string): number {
  const value = input[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("字段 " + name + " 无效");
  return value;
}
function names(input: Record<string, unknown>, name: string): string[] {
  const value = input[name];
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((item) => typeof item !== "string" || !item.trim() || item.length > 120)
  ) {
    throw new Error("字段 " + name + " 无效");
  }
  const result: string[] = value;
  if (new Set(result).size !== result.length) throw new Error("字段 " + name + " 不能重复");
  return result;
}
function botDraft(input: Record<string, unknown>): Partial<Bot> & { name: string } {
  const draft: Partial<Bot> & { name: string } = { name: text(input, "name", 80) };
  if (input.modelId !== undefined)
    draft.model = {
      provider: text(input, "provider", 120),
      modelId: text(input, "modelId", 120),
    };
  if (input.thinkingLevel !== undefined) {
    const value = text(input, "thinkingLevel", 20);
    if (
      value !== "minimal" &&
      value !== "low" &&
      value !== "medium" &&
      value !== "high" &&
      value !== "xhigh"
    ) {
      throw new Error("思考级别无效");
    }
    draft.thinkingLevel = value;
  }
  if (input.instructions !== undefined)
    draft.instructions = text(input, "instructions", 32_000, true);
  if (input.cwd !== undefined) draft.cwd = text(input, "cwd", 2_000, true);
  if (input.extensions !== undefined) draft.extensions = names(input, "extensions");
  if (input.tools !== undefined) draft.tools = names(input, "tools");
  return draft;
}

// External data is decoded here. Harness operations only receive typed parameters.
export function createRequestHandler(runner: Runner) {
  return async (request: unknown): Promise<unknown> => {
    if (!request || typeof request !== "object" || Array.isArray(request))
      throw new Error("请求格式无效");
    const input = request as Record<string, unknown>;
    switch (input.op) {
      case "providerRequest":
        return runner.providerRequest(input.request);
      case "initialize":
        return runner.initialize();
      case "createBot":
        return runner.createBot(botDraft(input));
      case "updateBot":
        return runner.updateBot(
          text(input, "botId", 100),
          botDraft(input),
          text(input, "configVersion", 128),
        );
      case "archiveBot":
        return runner.archiveBot(text(input, "botId", 100), text(input, "configVersion", 128));
      case "reloadConfiguration":
        return runner.reloadConfiguration();
      case "readConfiguration":
        return runner.readConfiguration(text(input, "path", 2_000));
      case "saveConfiguration":
        return runner.saveConfiguration(
          text(input, "path", 2_000),
          text(input, "version", 128),
          text(input, "content", 262_144, true),
        );
      case "createConversation":
        return runner.createConversation({
          botId: text(input, "botId", 100),
          cwd: text(input, "cwd", 2_000, true),
          goal: text(input, "goal", 8_000, true),
        });
      case "applyBotSettings":
        return runner.applyBotSettings(id(input, "conversationId"));
      case "saveGoal":
        return runner.saveGoal(
          id(input, "conversationId"),
          text(input, "description", 8_000, true),
        );
      case "setGoalStatus": {
        const status = text(input, "status", 16);
        if (status !== "open" && status !== "completed") throw new Error("工作目标状态无效");
        return runner.setGoalStatus(id(input, "conversationId"), status);
      }
      case "submit":
        return runner.submit({
          conversationId: id(input, "conversationId"),
          text: text(input, "text", 16_000),
          requestId: text(input, "requestId", 100),
        });
      case "abortSubmission":
        return runner.abortSubmission(id(input, "conversationId"), id(input, "submissionId"));
      case "abort":
        return runner.abort(id(input, "conversationId"));
      case "snapshot":
        return runner.snapshot(id(input, "conversationId"));
      case "setProviderCredential":
        return runner.setProviderCredential(input.apiKey);
      case "close":
        return runner.close();
      default:
        throw new Error("不支持的 Runner 操作");
    }
  };
}
