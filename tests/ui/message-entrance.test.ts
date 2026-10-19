import { describe, expect, it } from "vite-plus/test";

import { entranceTarget } from "@/features/chat/use-message-entrance";

describe("entranceTarget", () => {
  it("returns null without a Conversation or before the snapshot is ready", () => {
    expect(entranceTarget({ conversationId: null, rowId: null }, null, "1:2", true)).toBeNull();
    expect(entranceTarget({ conversationId: 1, rowId: "1:1" }, 1, "1:2", false)).toBeNull();
  });

  it("returns null when switching Conversations, so history never replays", () => {
    expect(entranceTarget({ conversationId: 1, rowId: "1:9" }, 2, "2:3", true)).toBeNull();
  });

  it("returns null on first load of a Conversation", () => {
    expect(entranceTarget({ conversationId: null, rowId: null }, 1, "1:5", true)).toBeNull();
  });

  it("returns null when the latest row did not change", () => {
    expect(entranceTarget({ conversationId: 1, rowId: "1:5" }, 1, "1:5", true)).toBeNull();
  });

  it("animates a row that newly becomes latest in the on-screen Conversation", () => {
    expect(entranceTarget({ conversationId: 1, rowId: "1:5" }, 1, "1:6", true)).toBe("1:6");
  });
});
