import { useEffect } from "react";
import { usePanelRef } from "react-resizable-panels";

// Panel refs throw while the group has no measurable layout (first paint); the toggle
// state stays the source of truth and the next change retries the expand/collapse.
function useCollapseEffect(
  panelRef: ReturnType<typeof usePanelRef>,
  open: boolean,
  active: boolean,
) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !active) return;
    try {
      if (open) panel.expand();
      else panel.collapse();
    } catch {
      // No measurable layout yet; the next toggle retries.
    }
  }, [panelRef, open, active]);
}

// Owns the desktop workspace panels' collapse/expand behaviour, so the workspace shell
// only declares layout structure.
export function useWorkspacePanels({
  settingsActive,
  botListOpen,
  detailsOpen,
  chatActive,
}: {
  settingsActive: boolean;
  botListOpen: boolean;
  detailsOpen: boolean;
  chatActive: boolean;
}) {
  const botListPanelRef = usePanelRef();
  const detailsPanelRef = usePanelRef();

  useCollapseEffect(botListPanelRef, botListOpen, !settingsActive);
  // The details pane collapses to zero instead of unmounting: removing the panel would
  // redistribute its width across the remaining panels and shift the Bot list.
  useCollapseEffect(detailsPanelRef, detailsOpen && chatActive, true);

  return { botListPanelRef, detailsPanelRef };
}
