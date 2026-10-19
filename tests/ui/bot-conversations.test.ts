import { describe, expect, it } from "vite-plus/test";

import type { ConversationSummary } from "@/app/runner-client";
import { selectLatestConversation } from "@/features/bots/bot-conversations";

function conversation(id: number, botId: string, createdAt: number): ConversationSummary {
  return { id, botId, createdAt } as ConversationSummary;
}

describe("selectLatestConversation", () => {
  it("returns null when the Bot has no conversations", () => {
    expect(selectLatestConversation([], "bot-1")).toBeNull();
    expect(selectLatestConversation([conversation(1, "bot-2", 100)], "bot-1")).toBeNull();
  });

  it("picks the most recently created conversation for the Bot", () => {
    const conversations = [
      conversation(1, "bot-1", 100),
      conversation(2, "bot-1", 300),
      conversation(3, "bot-1", 200),
    ];
    expect(selectLatestConversation(conversations, "bot-1")?.id).toBe(2);
  });

  it("breaks createdAt ties by larger id", () => {
    const conversations = [conversation(4, "bot-1", 100), conversation(7, "bot-1", 100)];
    expect(selectLatestConversation(conversations, "bot-1")?.id).toBe(7);
  });

  it("ignores conversations belonging to other Bots", () => {
    const conversations = [conversation(1, "bot-1", 100), conversation(2, "bot-2", 999)];
    expect(selectLatestConversation(conversations, "bot-1")?.id).toBe(1);
  });
});
