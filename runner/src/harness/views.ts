import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AgentDoc, type Harness } from "@earendil-works/pi-durable";

import type { createAgentResolver } from "./agent.js";
import { GoalState } from "./extensions/work-goal.js";
import { projectMessages } from "./messages.js";
import { conversationById } from "./operations.js";
import { ConversationMetadata } from "./product-state.js";

const context = BACKGROUND_CONTEXT;
export function createViews(
  harness: Harness,
  resolver: ReturnType<typeof createAgentResolver>,
  isConfigured: () => boolean,
) {
  async function configurationErrors(conversation: { id: Parameters<Harness["conversation"]>[0] }) {
    const agent = await harness.snapshot(AgentDoc, conversation.id, context);
    return resolver.missing(agent?.extensions, agent?.tools);
  }
  return async function snapshot(id: number) {
    const conversation = await conversationById(harness, id);
    const state = await conversation.viewState(context);
    const graph = await harness.taskGraph(context);
    try {
      const metadata = await harness.snapshot(ConversationMetadata, conversation.id, context);
      const goal = await harness.snapshot(GoalState, conversation.id, context);
      const agent = await conversation.agent(context);
      const missing = await configurationErrors(conversation);
      const { messages, hasMoreMessages } = projectMessages(state.value.entries);
      const inspection = await harness.inspect(context);
      const activeTasks = Object.values(graph.value.tasks)
        .filter((task) => task.conversationId === conversation.id)
        .map((task) => ({
          id: task.id,
          kind: task.kind,
          status: task.state.status,
          phase: "phase" in task.state ? task.state.phase : "",
          owner: task.owner ?? null,
          background: task.background,
          abortRequested: task.abortRequested,
        }));
      const submissions = inspection.submissions
        .filter((submission) => submission.conversationId === conversation.id)
        .map((submission) => ({
          id: submission.id,
          type: submission.type,
          status: submission.status,
        }));
      return {
        conversation: {
          id: conversation.id,
          botId: metadata?.botId ?? "",
          botName: metadata?.botName ?? "Conversation",
          botConfigVersion: metadata?.botConfigVersion ?? "",
          agent: {
            model: agent.model ?? null,
            thinkingLevel: agent.thinkingLevel,
            instructions: agent.instructions ?? "",
            cwd: agent.cwd ?? "",
            extensions: agent.extensions.map((extension) => extension.name),
            tools: agent.callable.map((tool) => tool.name),
          },
        },
        goal: goal ?? { description: "", status: "open", updatedAt: 0, completedAt: null },
        messages,
        hasMoreMessages,
        activeTasks,
        submissions,
        configurationErrors: missing,
        apiKeyConfigured: isConfigured(),
      };
    } finally {
      state.dispose();
      graph.dispose();
    }
  };
}
