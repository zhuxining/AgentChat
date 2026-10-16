import { createContext, useContext, useState, type ReactNode } from "react";

type WorkspaceUi = {
  botSearch: string;
  setBotSearch: (value: string) => void;
  detailsOpen: boolean;
  detailsAnimating: boolean;
  botListOpen: boolean;
  setBotListOpen: (open: boolean) => void;
  toggleBotList: () => void;
  toggleDetails: () => void;
};

const WorkspaceUiContext = createContext<WorkspaceUi | null>(null);

// Client-side workspace UI state that survives layout and page changes: the Bot search
// query, the visibility of the Bot list and details panels.
export function WorkspaceUiProvider({ children }: { children: ReactNode }) {
  const [botSearch, setBotSearch] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsAnimating, setDetailsAnimating] = useState(false);
  const [botListOpen, setBotListOpen] = useState(true);
  function toggleBotList() {
    setBotListOpen((open) => !open);
  }
  // The panel only transitions for the programmatic toggle; dragging its handle stays
  // immediate, so the flag is cleared once the collapse/expand has finished.
  function toggleDetails() {
    setDetailsAnimating(true);
    setDetailsOpen((open) => !open);
    window.setTimeout(() => setDetailsAnimating(false), 260);
  }
  return (
    <WorkspaceUiContext.Provider
      value={{
        botSearch,
        setBotSearch,
        detailsOpen,
        detailsAnimating,
        botListOpen,
        setBotListOpen,
        toggleBotList,
        toggleDetails,
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
