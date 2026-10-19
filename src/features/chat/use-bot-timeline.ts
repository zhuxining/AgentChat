import { useQueries } from "@tanstack/react-query";

import type { ConversationSnapshot, ConversationSummary } from "@/app/runner-client";
import { snapshotOptions, useRunnerLifecycle } from "@/app/runner-queries";
import { useWorkspaceResources } from "@/app/workspace-provider";

export type TimelineSegment = { conversation: ConversationSummary; snapshot: ConversationSnapshot };

export function useBotTimeline(conversations: ConversationSummary[]): TimelineSegment[] {
  const { client } = useWorkspaceResources();
  const { paused } = useRunnerLifecycle();
  const queries = useQueries({
    queries: conversations.map((conversation) => ({
      ...snapshotOptions(client, conversation.id),
      enabled: !paused,
    })),
  });
  if (paused) return [];
  return conversations.flatMap((conversation, index) => {
    const snapshot = queries[index]?.data;
    return snapshot ? [{ conversation, snapshot }] : [];
  });
}
