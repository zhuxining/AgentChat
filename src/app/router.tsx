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
import { useEffect } from "react";

import { useBotSearch } from "@/app/bot-search-provider";
import { useWorkspaceContext } from "@/app/workspace-provider";
import { BotDetailsPage } from "@/features/bots/bot-details-page";
import { BotDetailsPane } from "@/features/bots/bot-details-pane";
import { BotList } from "@/features/bots/bot-list";
import { EditBotPage } from "@/features/bots/edit-bot-page";
import { NewBotPage } from "@/features/bots/new-bot-page";
import { useBotSummaries } from "@/features/bots/use-bot-summaries";
import { ChatView } from "@/features/chat/chat-view";
import { AboutSettings } from "@/features/settings/about-settings";
import { GeneralSettings } from "@/features/settings/general-settings";
import { ProviderSettings } from "@/features/settings/provider-settings";
import { RunnerSettings } from "@/features/settings/runner-settings";
import { SettingsLayout } from "@/features/settings/settings-layout";
import { cn } from "@/lib/utils";

// Responsive contract: the Bot list is part of the shell at md+ and becomes the index
// page below md; the detail pane joins the chat at xl+; every other view is a page.
function WorkspaceShell() {
  const workspace = useWorkspaceContext();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const { search, setSearch } = useBotSearch();
  const chatMatch = matchRoute({ to: "/bots/$botId", fuzzy: false });
  const newBotMatch = matchRoute({ to: "/bots/new" });
  const indexMatch = matchRoute({ to: "/" });
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
  return (
    <main className="bg-background text-foreground flex h-full min-h-0 overflow-hidden">
      <aside
        aria-label="Bot 列表"
        className={cn(
          "bg-sidebar min-h-0 shrink-0 flex-col border-r",
          indexMatch ? "flex w-full md:w-64 xl:w-72" : "hidden md:flex md:w-64 xl:w-72",
        )}
      >
        <BotList
          bots={workspace.catalog.bots}
          selectedBotId={workspace.selection.selectedBotId}
          summaries={summaries}
          search={search}
          busy={workspace.connection.busy}
          onSearchChange={setSearch}
          onSelect={(botId) => void navigate({ to: "/bots/$botId", params: { botId } })}
          onNewBot={() => void navigate({ to: "/bots/new" })}
          onSettings={() =>
            void navigate({ to: "/settings/$section", params: { section: "provider" } })
          }
        />
      </aside>
      <Outlet />
      {chatMatch && !newBotMatch && (
        <aside className="hidden min-h-0 xl:flex">
          <BotDetailsPane />
        </aside>
      )}
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

function EditBotRoute() {
  const { botId } = useParams({ from: "/bots/$botId/edit" });
  useRouteBot(botId);
  return <EditBotPage botId={botId} />;
}

function SettingsSectionPage() {
  const { section } = useParams({ from: "/settings/$section" });
  if (section === "provider") return <ProviderSettings />;
  if (section === "runner") return <RunnerSettings />;
  if (section === "about") return <AboutSettings />;
  return <GeneralSettings />;
}

function BotsIndexPage() {
  return (
    <section
      aria-label="选择 Bot"
      className="hidden min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center md:flex"
    >
      <h2 className="text-lg font-medium">选择一个 Bot 开始聊天</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        每个 Bot 有独立的配置与连续对话。用列表右上角的 + 创建后即可开始工作。
      </p>
    </section>
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

const botEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bots/$botId/edit",
  component: EditBotRoute,
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
  botEditRoute,
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
