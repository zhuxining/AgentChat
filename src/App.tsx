import { RouterProvider } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";

import { MobileClient } from "@/app/mobile-client";
import { createAppRouter } from "@/app/router";
import { RuntimeGate } from "@/app/runtime-gate";
import { ThemeProvider } from "@/app/theme";
import { WorkspaceProvider } from "@/app/workspace-provider";
import { WorkspaceUiProvider } from "@/app/workspace-ui";

export default function App() {
  const currentPlatform = isTauri() ? platform() : undefined;
  const mobile = currentPlatform === "android" || currentPlatform === "ios";
  useEffect(() => {
    if (!currentPlatform) return;

    document.documentElement.dataset.platform = currentPlatform;
    if (mobile) {
      return () => {
        delete document.documentElement.dataset.platform;
      };
    }
    const appWindow = getCurrentWindow();

    function handleMouseDown(event: MouseEvent) {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const titlebar = event.target.closest("[data-window-titlebar]");
      if (!titlebar) return;
      if (
        event.target.closest(
          "button, a, input, textarea, select, [role='button'], [contenteditable='true']",
        )
      ) {
        return;
      }

      if (event.detail === 2) {
        event.preventDefault();
        void appWindow.toggleMaximize();
      } else {
        void appWindow.startDragging();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      delete document.documentElement.dataset.platform;
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [currentPlatform, mobile]);

  return <ThemeProvider>{mobile ? <MobileClient /> : <DesktopApp />}</ThemeProvider>;
}

function DesktopApp() {
  // One router per mount keeps navigation state isolated between sessions and tests.
  const [router] = useState(createAppRouter);

  return (
    <RuntimeGate>
      <WorkspaceProvider>
        <WorkspaceUiProvider>
          <RouterProvider router={router} />
        </WorkspaceUiProvider>
      </WorkspaceProvider>
    </RuntimeGate>
  );
}
