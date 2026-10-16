import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";

import { BotSearchProvider } from "@/app/bot-search-provider";
import { createAppRouter } from "@/app/router";
import { WorkspaceProvider } from "@/app/workspace-provider";

export default function App() {
  // One router per mount keeps navigation state isolated between sessions and tests.
  const [router] = useState(createAppRouter);
  return (
    <WorkspaceProvider>
      <BotSearchProvider>
        <RouterProvider router={router} />
      </BotSearchProvider>
    </WorkspaceProvider>
  );
}
