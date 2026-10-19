import type { ConversationSummary } from "@/app/runner-client";

// Product rule: a Bot's "current" Conversation is its most recently created one.
// Both the Bot list summary and the workspace chat derive from this single rule so
// they can never disagree about which Conversation a Bot points at.
export function selectLatestConversation(
  conversations: ConversationSummary[],
  botId: string,
): ConversationSummary | null {
  return (
    conversations
      .filter((item) => item.botId === botId)
      .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id)[0] ?? null
  );
}
