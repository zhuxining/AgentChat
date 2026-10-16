import { useQueries } from "@tanstack/react-query";

import type { ConversationSnapshot, ConversationSummary } from "@/app/runner-client";
import { runnerClient } from "@/app/runner-client";

export type TimelineSegment = { conversation: ConversationSummary; snapshot: ConversationSnapshot };

// One Bot reads as a single continuous chat: earlier conversations are loaded once and
// rendered above the live conversation instead of becoming separate entries to manage.
// A segment appears only once its snapshot is available.
export function useBotTimeline(
  conversations: ConversationSummary[],
  live: { id: number | null; snapshot: ConversationSnapshot | null },
): TimelineSegment[] {
  const history = conversations.filter((conversation) => conversation.id !== live.id);
  const queries = useQueries({
    queries: history.map((conversation) => ({
      queryKey: ["conversation-timeline", conversation.id],
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      queryFn: () => runnerClient.snapshot(conversation.id),
    })),
  });
  const segments: TimelineSegment[] = [];
  history.forEach((conversation, index) => {
    const snapshot = queries[index]?.data;
    if (snapshot) segments.push({ conversation, snapshot });
  });
  if (live.id !== null && live.snapshot) {
    const conversation = conversations.find((item) => item.id === live.id);
    if (conversation) segments.push({ conversation, snapshot: live.snapshot });
  }
  return segments;
}
