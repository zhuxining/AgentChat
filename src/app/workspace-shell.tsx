import { Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { PanelLeftIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { useRunnerCatalog, useConversationSnapshot } from "@/app/runner-queries";
import { useWorkspacePanels } from "@/app/use-workspace-panels";
import { useWorkspaceUi } from "@/app/workspace-ui";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { selectLatestConversation } from "@/features/bots/bot-conversations";
import { BotDetailsPane } from "@/features/bots/bot-details-pane";
import { BotList } from "@/features/bots/bot-list";
import { useRouteBotId } from "@/features/bots/bot-queries";
import { useBotSummaries } from "@/features/bots/use-bot-summaries";
import { useMediaQuery } from "@/hooks/use-media-query";

// A fully collapsed Bot list gives the chat area the whole remaining width.
const botListCollapsedSize = 0;

// Desktop is a resizable three-pane workspace: the Bot list and the details pane are
// panels the reader can drag or push away. Below that width the same views become pages.
export function WorkspaceShell() {
  const { data: catalog, isPending: loading } = useRunnerCatalog();
  const selectedBotId = useRouteBotId();
  const conversationId =
    selectLatestConversation(catalog?.conversations ?? [], selectedBotId)?.id ?? null;
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { botSearch, setBotSearch, botListOpen, setBotListOpen, toggleBotList, detailsOpen } =
    useWorkspaceUi(
      useShallow((state) => ({
        botSearch: state.botSearch,
        setBotSearch: state.setBotSearch,
        botListOpen: state.botListOpen,
        setBotListOpen: state.setBotListOpen,
        toggleBotList: state.toggleBotList,
        detailsOpen: state.detailsOpen,
      })),
    );
  const chatMatch = matchRoute({ to: "/bots/$botId", fuzzy: false });
  const newBotMatch = matchRoute({ to: "/bots/new" });
  const settingsMatch = matchRoute({ to: "/settings", fuzzy: true });
  const isChatRoute = Boolean(chatMatch) && !newBotMatch;
  const summaries = useBotSummaries(catalog?.bots ?? [], catalog?.conversations ?? []);
  const { botListPanelRef, detailsPanelRef } = useWorkspacePanels({
    settingsActive: Boolean(settingsMatch),
    botListOpen,
    detailsOpen,
    chatActive: isChatRoute,
  });

  if (loading) {
    return (
      <main className="text-muted-foreground grid h-full place-items-center text-sm">
        正在打开 Runner…
      </main>
    );
  }
  if (!isDesktop) {
    return (
      <main className="bg-background text-foreground flex h-full min-h-0 overflow-hidden">
        <LiveConversationPoll conversationId={conversationId} />
        <Outlet />
      </main>
    );
  }
  const botList = (
    <BotList
      bots={catalog?.bots ?? []}
      selectedBotId={selectedBotId}
      summaries={summaries}
      search={botSearch}
      busy={false}
      onSearchChange={setBotSearch}
      onSelect={(botId) => void navigate({ to: "/bots/$botId", params: { botId } })}
      onNewBot={() => void navigate({ to: "/bots/new" })}
      onToggleSidebar={toggleBotList}
      onSettings={() =>
        void navigate({
          to: "/settings/$section",
          params: { section: "provider" },
          search: { returnBotId: selectedBotId || undefined },
        })
      }
    />
  );
  return (
    <main
      data-bot-list-closed={!settingsMatch && !botListOpen ? "true" : undefined}
      className="bg-background text-foreground relative flex h-full min-h-0 overflow-hidden"
    >
      <LiveConversationPoll conversationId={conversationId} />
      {!settingsMatch && !botListOpen && (
        <Button
          data-bot-list-reopen
          aria-label="展开 Bot 侧栏"
          title="展开 Bot 侧栏"
          variant="ghost"
          size="icon-sm"
          aria-expanded={botListOpen}
          onClick={toggleBotList}
        >
          <PanelLeftIcon />
        </Button>
      )}
      <ResizablePanelGroup>
        {!settingsMatch && (
          <>
            <ResizablePanel
              id="bots"
              panelRef={botListPanelRef}
              collapsible
              collapsedSize={botListCollapsedSize}
              defaultSize={260}
              minSize={200}
              maxSize={420}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => setBotListOpen(size.inPixels > botListCollapsedSize)}
              className="overflow-hidden"
            >
              <aside
                aria-label={botListOpen ? "Bot 列表" : "已折叠的 Bot 侧栏"}
                aria-hidden={!botListOpen}
                className="bg-sidebar flex h-full min-h-0 flex-col overflow-hidden"
              >
                {botListOpen && botList}
              </aside>
            </ResizablePanel>
            <ResizableHandle className="after:w-2" />
          </>
        )}
        <ResizablePanel id="main" minSize={360} className="flex min-h-0 flex-col overflow-hidden">
          <Outlet />
        </ResizablePanel>
        {!settingsMatch && (
          <>
            <ResizableHandle className="after:w-2" />
            <ResizablePanel
              id="details"
              panelRef={detailsPanelRef}
              collapsible
              collapsedSize={0}
              defaultSize={340}
              minSize={260}
              maxSize={560}
              groupResizeBehavior="preserve-pixel-size"
              className="overflow-hidden"
            >
              {isChatRoute && <BotDetailsPane />}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </main>
  );
}

function LiveConversationPoll({ conversationId }: { conversationId: number | null }) {
  useConversationSnapshot(conversationId, true);
  return null;
}
