import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { runnerClient } from "@/app/runner-client";
import { createChatDraftStore } from "@/features/chat/chat-draft-store";

type WorkspaceResources = {
  client: typeof runnerClient;
  drafts: ReturnType<typeof createChatDraftStore>;
};
const WorkspaceContext = createContext<WorkspaceResources | null>(null);

// Context carries stable resources only. Data observers and selectors own subscriptions.
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [resources] = useState(() => ({ client: runnerClient, drafts: createChatDraftStore() }));
  return <WorkspaceContext.Provider value={resources}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceResources() {
  const resources = useContext(WorkspaceContext);
  if (!resources) throw new Error("必须在 WorkspaceProvider 内使用");
  return resources;
}

export function useChatDraft<T>(
  selector: (state: ReturnType<WorkspaceResources["drafts"]["getState"]>) => T,
) {
  return useStore(useWorkspaceResources().drafts, selector);
}
