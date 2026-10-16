import { defineDoc, defineExtension, section, type JsonObject } from "@earendil-works/pi-durable";

export const GoalState = defineDoc<
  JsonObject & {
    description: string;
    status: "open" | "completed";
    updatedAt: number;
    completedAt: number | null;
  }
>({
  kind: "agentchat.work-goal",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ description: "", status: "open", updatedAt: 0, completedAt: null }),
});

export const workGoalExtension = defineExtension({
  name: "agentchat-work-goal",
  sections: [
    section("work-goal", async ({ conversationId, read }, context) => {
      const goal = await read.snapshot(GoalState, conversationId, context);
      if (!goal?.description.trim()) return undefined;
      const status =
        goal.status === "completed"
          ? "The user explicitly marked this goal complete. Do not claim a different completion state; handle new requests normally."
          : "The goal remains open until the user explicitly marks it complete. Ending a run or task does not complete it.";
      return goal.description + "\n\nGoal status: " + status;
    }),
  ],
});
