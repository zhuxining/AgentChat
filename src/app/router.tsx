import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { useRunnerCatalog } from "@/app/runner-queries";
import { WorkspaceShell } from "@/app/workspace-shell";
import { useWorkspaceUi } from "@/app/workspace-ui";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { BotDetailsPage } from "@/features/bots/bot-details-page";
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

const rootRoute = createRootRoute({ component: WorkspaceShell });

function ChatPage() {
  const { botId } = useParams({ from: "/bots/$botId" });
  return <ChatView botId={botId} />;
}

function BotDetailsRoute() {
  const { botId } = useParams({ from: "/bots/$botId/details" });
  return <BotDetailsPage botId={botId} />;
}

function SettingsSectionPage() {
  const { section } = useParams({ from: "/settings/$section" });
  // Every section stays mounted so unsaved drafts survive switching categories; leaving
  // settings unmounts all of them, which is what clears the credential draft.
  return (
    <>
      <div hidden={section !== "general"}>
        <GeneralSettings />
      </div>
      <div hidden={section !== "provider"}>
        <ProviderSettings />
      </div>
      <div hidden={section !== "runner"}>
        <RunnerSettings />
      </div>
      <div hidden={section !== "about"}>
        <AboutSettings />
      </div>
    </>
  );
}

// The Bot list is the workspace's own left pane on desktop and the index page below it.
function BotsIndexPage() {
  const { data: catalog } = useRunnerCatalog();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { botSearch, setBotSearch } = useWorkspaceUi(
    useShallow((state) => ({ botSearch: state.botSearch, setBotSearch: state.setBotSearch })),
  );
  const summaries = useBotSummaries(catalog?.bots ?? [], catalog?.conversations ?? []);
  return (
    <>
      {!isDesktop && (
        <section
          aria-label="Bot 列表页"
          className="bg-sidebar animate-fade-in flex h-full min-h-0 flex-1 flex-col"
        >
          <BotList
            bots={catalog?.bots ?? []}
            selectedBotId=""
            summaries={summaries}
            search={botSearch}
            busy={false}
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
        <section
          aria-label="选择 Bot"
          className="animate-fade-in flex h-full min-h-0 min-w-0 flex-1"
        >
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
  validateSearch: (search: Record<string, unknown>): { returnBotId?: string } => ({
    returnBotId: typeof search.returnBotId === "string" ? search.returnBotId : undefined,
  }),
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
