import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { AgentDoc, type Harness, type ConversationId } from "@earendil-works/pi-durable";

import type { createAgentResolver } from "../agent.js";

const context = BACKGROUND_CONTEXT;

export async function conversationById(harness: Harness, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("无效的执行对话 ID");
  const conversation = await harness.conversation(id as ConversationId, context);
  if (!conversation) throw new Error("执行对话不存在");
  return conversation;
}

// A Conversation must be idle before Bot settings apply: no live Task and no queued
// or placed Submission, otherwise the new configuration would mix into a running Turn.
export async function requireIdle(harness: Harness, id: ConversationId) {
  const inspection = await harness.inspect(context);
  if (
    inspection.tasks.some((task) => task.record.conversationId === id) ||
    inspection.submissions.some(
      (item) =>
        item.conversationId === id && (item.status === "queued" || item.status === "placed"),
    )
  ) {
    throw new Error("Conversation 正在运行或有输入排队，必须等它空闲后才能应用 Bot 设置。");
  }
}

// The stored Agent configuration must still resolve: extensions, tools and model may
// have become unavailable since the Conversation last ran.
export async function requireAvailable(
  harness: Harness,
  models: MutableModels,
  resolver: ReturnType<typeof createAgentResolver>,
  id: ConversationId,
) {
  const stored = await harness.snapshot(AgentDoc, id, context);
  const missing = resolver.missing(stored?.extensions, stored?.tools);
  if (missing.missingExtensions.length || missing.missingTools.length) {
    throw new Error(
      "执行配置引用了当前不可用的能力：" +
        [...missing.missingExtensions, ...missing.missingTools].join("、"),
    );
  }
  if (stored?.model && !models.getModel(stored.model.provider, stored.model.modelId)) {
    throw new Error("执行配置中的模型当前不可用，请显式应用可用配置。");
  }
}
