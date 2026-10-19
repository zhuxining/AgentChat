import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";

import { GoalState } from "../extensions/work-goal.js";
import type { Mutate } from "./mutation-queue.js";
import { conversationById } from "./shared.js";

const context = BACKGROUND_CONTEXT;

// 工作目标：描述写入与完成状态确认，属于用户与 Bot 协作层面的状态而非执行任务。
export function createWorkGoalOperations(harness: Harness, mutate: Mutate) {
  return {
    saveGoal: (id: number, description: string) =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        await harness.commit(async (tx) => {
          const goal = await tx.doc(GoalState, conversation.id);
          if (goal.description !== description) {
            goal.status = "open";
            goal.completedAt = null;
          }
          goal.description = description;
          goal.updatedAt = Date.now();
        }, context);
        return harness.snapshot(GoalState, conversation.id, context);
      }),
    setGoalStatus: (id: number, status: "open" | "completed") =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        await harness.commit(async (tx) => {
          const goal = await tx.doc(GoalState, conversation.id);
          if (!goal.description.trim()) throw new Error("请先保存工作目标描述");
          const now = Date.now();
          goal.status = status;
          goal.updatedAt = now;
          goal.completedAt = status === "completed" ? now : null;
        }, context);
        return harness.snapshot(GoalState, conversation.id, context);
      }),
  };
}
