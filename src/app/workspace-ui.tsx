import { createContext, useContext, useState, type ReactNode } from "react";

type WorkspaceUi = {
  botSearch: string;
  setBotSearch: (value: string) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  toggleDetails: () => void;
};

const WorkspaceUiContext = createContext<WorkspaceUi | null>(null);

// Client-side workspace UI state that must survive layout and page changes: the Bot
// search query and whether the details panel is pushed out.
export function WorkspaceUiProvider({ children }: { children: ReactNode }) {
  const [botSearch, setBotSearch] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  return (
    <WorkspaceUiContext.Provider
      value={{
        botSearch,
        setBotSearch,
        detailsOpen,
        setDetailsOpen,
        toggleDetails: () => setDetailsOpen((open) => !open),
      }}
    >
      {children}
    </WorkspaceUiContext.Provider>
  );
}

export function useWorkspaceUi(): WorkspaceUi {
  const value = useContext(WorkspaceUiContext);
  if (!value) throw new Error("useWorkspaceUi 必须在 WorkspaceUiProvider 内使用");
  return value;
}
