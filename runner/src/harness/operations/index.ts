import type { MutableModels } from "@earendil-works/pi-ai/models";
import type { Harness } from "@earendil-works/pi-durable";

import type { Configuration } from "../../config/configuration.js";
import type { createAgentResolver } from "../agent.js";
import { createBotMemoryOperations } from "./bot-memory.js";
import { createConversationOperations } from "./conversations.js";
import { createMutationQueue } from "./mutation-queue.js";
import { createSubmissionOperations } from "./submissions.js";
import { createWorkGoalOperations } from "./work-goal.js";

// views.ts 与各用例模块共享同一 Conversation 查找与错误语义。
export { conversationById } from "./shared.js";

// 对外仍是一个 Runner 操作接口：handlers 与 open.ts 只消费这个聚合，内部按
// Conversation 生命周期、工作目标、Submission 三类用例拆分并共享串行队列。
export function createOperations(
  harness: Harness,
  configuration: Configuration,
  models: MutableModels,
  resolver: ReturnType<typeof createAgentResolver>,
  dataDir: string,
) {
  const mutate = createMutationQueue();
  return {
    mutate,
    ...createConversationOperations(harness, configuration, resolver, mutate),
    ...createBotMemoryOperations(harness, configuration, mutate),
    ...createWorkGoalOperations(harness, mutate),
    ...createSubmissionOperations(harness, models, resolver, mutate, dataDir),
  };
}
