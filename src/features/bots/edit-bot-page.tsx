import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

import { useWorkspaceContext } from "@/app/workspace-provider";
import { Button } from "@/components/ui/button";
import { BotConfigForm } from "@/features/bots/bot-config-form";

export function EditBotPage({ botId }: { botId: string }) {
  const { catalog, connection, feedback, actions } = useWorkspaceContext();
  const navigate = useNavigate();
  const bot = catalog.bots.find((item) => item.id === botId && !item.archived);
  return (
    <section aria-label="编辑 Bot" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-3 md:px-4">
        <Button
          aria-label="返回 Bot 详情"
          variant="ghost"
          size="icon-sm"
          onClick={() => void navigate({ to: "/bots/$botId/details", params: { botId } })}
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" data-tauri-drag-region>
          编辑 Bot
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-xl">
          {!bot ? (
            <p className="text-muted-foreground text-sm">
              找不到这个 Bot，可能已被归档。返回列表选择一个可用的 Bot。
            </p>
          ) : !catalog.botDefaults ? (
            <p className="text-muted-foreground text-sm">正在打开 Runner…</p>
          ) : (
            <BotConfigForm
              key={bot.id}
              bot={bot}
              capabilities={catalog.capabilities}
              defaults={catalog.botDefaults}
              busy={connection.busy}
              error={feedback.error}
              onSubmit={async (draft) => {
                const saved = await actions.saveBot(bot.id, draft, bot.configVersion);
                if (saved) await navigate({ to: "/bots/$botId/details", params: { botId } });
              }}
              onCancel={() => void navigate({ to: "/bots/$botId/details", params: { botId } })}
              onArchive={async () => {
                const archived = await actions.archiveBot(bot);
                if (archived) await navigate({ to: "/" });
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
