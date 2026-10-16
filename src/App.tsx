import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";

import { createAppRouter } from "@/app/router";
import { WorkspaceProvider } from "@/app/workspace-provider";
import { WorkspaceUiProvider } from "@/app/workspace-ui";

export default function App() {
  // One router per mount keeps navigation state isolated between sessions and tests.
  const [router] = useState(createAppRouter);
  return (
    <WorkspaceProvider>
      <WorkspaceUiProvider>
        <RouterProvider router={router} />
      </WorkspaceUiProvider>
    </WorkspaceProvider>
  );
}
