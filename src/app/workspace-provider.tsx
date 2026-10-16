import { createContext, useContext, type ReactNode } from "react";

import { runnerClient } from "@/app/runner-client";
import { useWorkspace, type Workspace } from "@/app/use-workspace";

const WorkspaceContext = createContext<Workspace | null>(null);

// Single owner for Runner synchronization during the layout migration. Pages read the
// slice they need; per-feature state modules replace this seam one feature at a time.
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace(runnerClient);
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspaceContext 必须在 WorkspaceProvider 内使用");
  return workspace;
}
