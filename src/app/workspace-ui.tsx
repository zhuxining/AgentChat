import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

type WorkspaceUi = {
  botSearch: string;
  detailsOpen: boolean;
  botListOpen: boolean;
  setBotSearch: (value: string) => void;
  setBotListOpen: (open: boolean) => void;
  toggleBotList: () => void;
  toggleDetails: () => void;
};

export function createWorkspaceUiStore() {
  return createStore<WorkspaceUi>()((set) => ({
    botSearch: "",
    detailsOpen: true,
    botListOpen: true,
    setBotSearch: (botSearch) => set({ botSearch }),
    setBotListOpen: (botListOpen) => set({ botListOpen }),
    toggleBotList: () => set((state) => ({ botListOpen: !state.botListOpen })),
    toggleDetails: () => set((state) => ({ detailsOpen: !state.detailsOpen })),
  }));
}

const WorkspaceUiContext = createContext<ReturnType<typeof createWorkspaceUiStore> | null>(null);

export function WorkspaceUiProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createWorkspaceUiStore);
  return <WorkspaceUiContext.Provider value={store}>{children}</WorkspaceUiContext.Provider>;
}

export function useWorkspaceUi<T>(selector: (state: WorkspaceUi) => T): T {
  const store = useContext(WorkspaceUiContext);
  if (!store) throw new Error("useWorkspaceUi 必须在 WorkspaceUiProvider 内使用");
  return useStore(store, selector);
}
