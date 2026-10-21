import { createStore } from "zustand/vanilla";

import type { AttachmentReference, DraftAttachment } from "@/app/runner-client";

export type PendingSubmission = {
  botId: string;
  conversationId: number;
  text: string;
  revision: number;
  requestId: string;
  attachments: AttachmentReference[];
};

type GoalDraft = { updatedAt: number; value: string };
type ChatDraftState = {
  inputsByConversation: Record<number, string>;
  revisionsByConversation: Record<number, number>;
  goals: Record<number, GoalDraft>;
  attachmentsByConversation: Record<number, DraftAttachment[]>;
  pendingSubmission: PendingSubmission | null;
  submittingBotId: string | null;
  errors: Record<number, string>;
  setInput: (conversationId: number, value: string) => void;
  setGoal: (conversationId: number, updatedAt: number, value: string) => void;
  addAttachments: (conversationId: number, attachments: DraftAttachment[]) => void;
  removeAttachments: (conversationId: number, ids: string[]) => void;
};

// In-memory only. Request identity survives navigation, never a reload of the application.
export function createChatDraftStore() {
  return createStore<ChatDraftState>()((set) => ({
    inputsByConversation: {},
    revisionsByConversation: {},
    goals: {},
    attachmentsByConversation: {},
    pendingSubmission: null,
    submittingBotId: null,
    errors: {},
    setInput: (conversationId, value) =>
      set((state) => ({
        inputsByConversation: { ...state.inputsByConversation, [conversationId]: value },
        revisionsByConversation: {
          ...state.revisionsByConversation,
          [conversationId]: (state.revisionsByConversation[conversationId] ?? 0) + 1,
        },
      })),
    setGoal: (conversationId, updatedAt, value) =>
      set((state) => ({
        goals: { ...state.goals, [conversationId]: { updatedAt, value } },
      })),
    addAttachments: (conversationId, attachments) =>
      set((state) => ({
        attachmentsByConversation: {
          ...state.attachmentsByConversation,
          [conversationId]: [
            ...(state.attachmentsByConversation[conversationId] ?? []),
            ...attachments,
          ],
        },
      })),
    removeAttachments: (conversationId, ids) =>
      set((state) => ({
        attachmentsByConversation: {
          ...state.attachmentsByConversation,
          [conversationId]: (state.attachmentsByConversation[conversationId] ?? []).filter(
            (attachment) => !ids.includes(attachment.id),
          ),
        },
      })),
  }));
}
