import { createContext, useContext, useState, type ReactNode } from "react";

type WorkspaceUi = {
  botSearch: string;
  setBotSearch: (value: string) => void;
  detailsOpen: boolean;
  detailsAnimating: boolean;
  toggleDetails: () => void;
};

const WorkspaceUiContext = createContext<WorkspaceUi | null>(null);

// Client-side workspace UI state that must survive layout and page changes: the Bot
// search query and whether the details panel is pushed out.
export function WorkspaceUiProvider({ children }: { children: ReactNode }) {
  const [botSearch, setBotSearch] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  // The panel only transitions for the programmatic toggle; dragging its handle stays
  // immediate, so the flag is cleared once the collapse/expand has finished.
  const [detailsAnimating, setDetailsAnimating] = useState(false);
  function toggleDetails() {
    setDetailsAnimating(true);
    setDetailsOpen((open) => !open);
    window.setTimeout(() => setDetailsAnimating(false), 260);
  }
  return (
    <WorkspaceUiContext.Provider
      value={{ botSearch, setBotSearch, detailsOpen, detailsAnimating, toggleDetails }}
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
