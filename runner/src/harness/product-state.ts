import { defineDoc, type JsonObject } from "@earendil-works/pi-durable";

export type ConversationSummary = {
  id: number;
  botId: string;
  botName: string;
  botConfigVersion: string;
  createdAt: number;
};

// Product window metadata is independent of the Harness execution mechanisms.
export const ConversationIndex = defineDoc<JsonObject & { conversations: ConversationSummary[] }>({
  kind: "agentchat.conversation-index",
  version: 1,
  scope: "session",
  initial: () => ({ conversations: [] }),
});
export const ConversationMetadata = defineDoc<
  JsonObject & {
    botId: string;
    botName: string;
    botConfigVersion: string;
    cwdOverride: string | null;
    createdAt: number;
  }
>({
  kind: "agentchat.conversation-metadata",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({
    botId: "",
    botName: "",
    botConfigVersion: "",
    cwdOverride: null,
    createdAt: 0,
  }),
});
