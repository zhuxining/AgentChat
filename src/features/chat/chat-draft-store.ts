import { createStore } from "zustand/vanilla";

export type PendingSubmission = {
  botId: string;
  conversationId: number;
  text: string;
  revision: number;
  requestId: string;
};

type GoalDraft = { updatedAt: number; value: string };
type ChatDraftState = {
  inputsByBot: Record<string, string>;
  revisions: Record<string, number>;
  goals: Record<number, GoalDraft>;
  pendingSubmission: PendingSubmission | null;
  submittingBotId: string | null;
  errors: Record<string, string>;
  setInput: (botId: string, value: string) => void;
  setGoal: (conversationId: number, updatedAt: number, value: string) => void;
};

// In-memory only. Request identity survives navigation, never a reload of the application.
export function createChatDraftStore() {
  return createStore<ChatDraftState>()((set) => ({
    inputsByBot: {},
    revisions: {},
    goals: {},
    pendingSubmission: null,
    submittingBotId: null,
    errors: {},
    setInput: (botId, value) =>
      set((state) => ({
        inputsByBot: { ...state.inputsByBot, [botId]: value },
        revisions: { ...state.revisions, [botId]: (state.revisions[botId] ?? 0) + 1 },
      })),
    setGoal: (conversationId, updatedAt, value) =>
      set((state) => ({
        goals: { ...state.goals, [conversationId]: { updatedAt, value } },
      })),
  }));
}
