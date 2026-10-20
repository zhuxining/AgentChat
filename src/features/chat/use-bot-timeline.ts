import { useQueries } from "@tanstack/react-query";
import { useState } from "react";

import type { ConversationSnapshot, ConversationSummary } from "@/app/runner-client";
import { snapshotOptions, useRunnerLifecycle } from "@/app/runner-queries";
import { useWorkspaceResources } from "@/app/workspace-provider";

export type TimelineSegment = { conversation: ConversationSummary; snapshot: ConversationSnapshot };

export function useBotTimeline(
  conversations: ConversationSummary[],
  selectedConversationId: number | null,
  selectedSnapshot: ConversationSnapshot | null,
) {
  const { client } = useWorkspaceResources();
  const { paused } = useRunnerLifecycle();
  const [historySelection, setHistorySelection] = useState<number | null>(null);
  const historyRequested = historySelection === selectedConversationId;
  const selectedIndex = conversations.findIndex(
    (conversation) => conversation.id === selectedConversationId,
  );
  const olderConversations = selectedIndex < 0 ? [] : conversations.slice(0, selectedIndex);
  const queries = useQueries({
    queries: olderConversations.map((conversation) => ({
      ...snapshotOptions(client, conversation.id),
      enabled: historyRequested && !paused,
    })),
  });

  const segments: TimelineSegment[] = [];
  if (historyRequested && !paused) {
    olderConversations.forEach((conversation, index) => {
      const snapshot = queries[index]?.data;
      if (snapshot) segments.push({ conversation, snapshot });
    });
  }
  const selectedConversation = conversations[selectedIndex];
  if (selectedConversation && selectedSnapshot) {
    segments.push({ conversation: selectedConversation, snapshot: selectedSnapshot });
  }

  const historyComplete =
    historyRequested && olderConversations.length > 0 && queries.every((query) => query.data);

  return {
    segments,
    hasOlder: olderConversations.length > 0 && !historyComplete,
    historyLoading: historyRequested && !paused && queries.some((query) => query.isPending),
    loadOlder: () => setHistorySelection(selectedConversationId),
  };
}
