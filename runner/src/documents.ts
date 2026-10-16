import { defineDoc, type JsonObject } from "@earendil-works/pi-durable";

import type { Bot } from "./bot.js";

type BotsDocument = JsonObject & { bots: Bot[]; conversations: ConversationSummary[] };
type ConversationMetadata = JsonObject & {
  botId: string;
  botName: string;
  botRevision: number;
  cwdOverride: string | null;
  createdAt: number;
};
export type ConversationSummary = {
  id: number;
  botId: string;
  botName: string;
  botRevision: number;
  createdAt: number;
};
type GoalDocument = JsonObject & {
  description: string;
  status: "open" | "completed";
  updatedAt: number;
  completedAt: number | null;
};
export const BotsDoc = defineDoc<BotsDocument>({
  kind: "app.bots",
  version: 1,
  scope: "session",
  initial: () => ({ bots: [], conversations: [] }),
});
export const ConversationDoc = defineDoc<ConversationMetadata>({
  kind: "app.conversation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({
    botId: "",
    botName: "Conversation",
    botRevision: 0,
    cwdOverride: null,
    createdAt: 0,
  }),
});
export const GoalDoc = defineDoc<GoalDocument>({
  kind: "app.work-goal",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ description: "", status: "open", updatedAt: 0, completedAt: null }),
});
