import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useMatchRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useEffect } from "react";

import { useWorkspaceContext } from "@/app/workspace-provider";
import { useWorkspaceUi } from "@/app/workspace-ui";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { BotDetailsPage } from "@/features/bots/bot-details-page";
import { BotDetailsPane } from "@/features/bots/bot-details-pane";
import { BotList } from "@/features/bots/bot-list";
import { NewBotPage } from "@/features/bots/new-bot-page";
import { useBotSummaries } from "@/features/bots/use-bot-summaries";
import { ChatView } from "@/features/chat/chat-view";
import { AboutSettings } from "@/features/settings/about-settings";
import { GeneralSettings } from "@/features/settings/general-settings";
import { ProviderSettings } from "@/features/settings/provider-settings";
import { RunnerSettings } from "@/features/settings/runner-settings";
import { SettingsLayout } from "@/features/settings/settings-layout";
import { useMediaQuery } from "@/hooks/use-media-query";

// Desktop is a resizable three-pane workspace: the Bot list and the details pane are
// panels the reader can drag or push away. Below that width the same views become pages.
function WorkspaceShell() {
  const workspace = useWorkspaceContext();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { botSearch, setBotSearch, detailsOpen } = useWorkspaceUi();
  const chatMatch = matchRoute({ to: "/bots/$botId", fuzzy: false });
  const newBotMatch = matchRoute({ to: "/bots/new" });
  const settingsMatch = matchRoute({ to: "/settings", fuzzy: true });
  const summaries = useBotSummaries(workspace.catalog.bots, workspace.catalog.conversations, {
    conversationId: workspace.selection.conversationId,
    latestMessage:
      workspace.selection.snapshot?.messages.filter((message) => message.text).at(-1)?.text ?? "",
    executing: workspace.conversation.executing,
  });
  if (workspace.connection.loading) {
    return (
      <main className="text-muted-foreground grid h-full place-items-center text-sm">
        正在打开 Runner…
      </main>
    );
  }
  if (!isDesktop) {
    return (
      <main className="bg-background text-foreground flex h-full min-h-0 overflow-hidden">
        <Outlet />
      </main>
    );
  }
  const botList = (
    <BotList
      bots={workspace.catalog.bots}
      selectedBotId={workspace.selection.selectedBotId}
      summaries={summaries}
      search={botSearch}
      busy={workspace.connection.busy}
      onSearchChange={setBotSearch}
      onSelect={(botId) => void navigate({ to: "/bots/$botId", params: { botId } })}
      onNewBot={() => void navigate({ to: "/bots/new" })}
      onSettings={() =>
        void navigate({ to: "/settings/$section", params: { section: "provider" } })
      }
    />
  );
  return (
    <main className="bg-background text-foreground flex h-full min-h-0 overflow-hidden">
      <ResizablePanelGroup>
        {!settingsMatch && (
          <>
            <ResizablePanel
              id="bots"
              defaultSize={260}
              minSize={200}
              maxSize={420}
              className="overflow-hidden"
            >
              <aside
                aria-label="Bot 列表"
                className="bg-sidebar flex h-full min-h-0 flex-col overflow-hidden"
              >
                {botList}
              </aside>
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}
        <ResizablePanel id="main" minSize={360} className="flex min-h-0 flex-col overflow-hidden">
          <Outlet />
        </ResizablePanel>
        {chatMatch && !newBotMatch && detailsOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="details"
              defaultSize={340}
              minSize={260}
              maxSize={560}
              className="overflow-hidden"
            >
              <BotDetailsPane />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </main>
  );
}

const rootRoute = createRootRoute({ component: WorkspaceShell });

// Route and workspace agree on which Bot is open; the workspace stays the data owner.
function useRouteBot(botId: string) {
  const workspace = useWorkspaceContext();
  const selectedBotId = workspace.selection.selectedBotId;
  useEffect(() => {
    if (botId && selectedBotId !== botId) workspace.actions.selectBot(botId);
  }, [botId, selectedBotId, workspace.actions]);
}

function ChatPage() {
  const { botId } = useParams({ from: "/bots/$botId" });
  useRouteBot(botId);
  return <ChatView botId={botId} />;
}

function BotDetailsRoute() {
  const { botId } = useParams({ from: "/bots/$botId/details" });
  useRouteBot(botId);
  return <BotDetailsPage botId={botId} />;
}

function SettingsSectionPage() {
  const { section } = useParams({ from: "/settings/$section" });
  if (section === "provider") return <ProviderSettings />;
  if (section === "runner") return <RunnerSettings />;
  if (section === "about") return <AboutSettings />;
  return <GeneralSettings />;
}

// The Bot list is the workspace's own left pane on desktop and the index page below it.
function BotsIndexPage() {
  const workspace = useWorkspaceContext();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { botSearch, setBotSearch } = useWorkspaceUi();
  const summaries = useBotSummaries(workspace.catalog.bots, workspace.catalog.conversations, {
    conversationId: workspace.selection.conversationId,
    latestMessage:
      workspace.selection.snapshot?.messages.filter((message) => message.text).at(-1)?.text ?? "",
    executing: workspace.conversation.executing,
  });
  return (
    <>
      {!isDesktop && (
        <section aria-label="Bot 列表页" className="bg-sidebar flex h-full min-h-0 flex-1 flex-col">
          <BotList
            bots={workspace.catalog.bots}
            selectedBotId={workspace.selection.selectedBotId}
            summaries={summaries}
            search={botSearch}
            busy={workspace.connection.busy}
            onSearchChange={setBotSearch}
            onSelect={(botId) => void navigate({ to: "/bots/$botId", params: { botId } })}
            onNewBot={() => void navigate({ to: "/bots/new" })}
            onSettings={() =>
              void navigate({ to: "/settings/$section", params: { section: "provider" } })
            }
          />
        </section>
      )}
      {isDesktop && (
        <section aria-label="选择 Bot" className="flex h-full min-h-0 min-w-0 flex-1">
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>选择一个 Bot 开始聊天</EmptyTitle>
              <EmptyDescription>
                每个 Bot 有独立的配置与连续对话。用左栏的 + 创建后即可开始工作。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </section>
      )}
    </>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BotsIndexPage,
});

const newBotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bots/new",
  component: NewBotPage,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bots/$botId",
  component: ChatPage,
});

const botDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bots/$botId/details",
  component: BotDetailsRoute,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => settingsIndexRoute,
  path: "$section",
  component: SettingsSectionPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  newBotRoute,
  chatRoute,
  botDetailsRoute,
  settingsIndexRoute.addChildren([settingsSectionRoute]),
]);

export function createAppRouter() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
