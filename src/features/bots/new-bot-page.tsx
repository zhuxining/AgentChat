import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

import { useRunnerCatalog } from "@/app/runner-queries";
import { Button } from "@/components/ui/button";
import { BotConfigForm } from "@/features/bots/bot-config-form";
import { useBotActions } from "@/features/bots/use-bot-actions";

export function NewBotPage() {
  const { data: catalog } = useRunnerCatalog();
  const actions = useBotActions();
  const navigate = useNavigate();
  return (
    <section
      aria-label="新建 Bot"
      className="animate-fade-in flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <header
        data-window-titlebar
        className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4"
      >
        <Button
          aria-label="返回 Bot 列表"
          variant="ghost"
          size="icon-sm"
          onClick={() => void navigate({ to: "/" })}
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" data-window-drag-region>
          新建 Bot
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-xl">
          {catalog?.botDefaults ? (
            <BotConfigForm
              providers={catalog.providers ?? []}
              capabilities={catalog.capabilities}
              defaults={catalog.botDefaults}
              busy={actions.busy}
              error={actions.error}
              onSubmit={async (draft) => {
                const bot = await actions.saveBot(null, draft);
                if (bot) await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
              }}
              onCancel={() => void navigate({ to: "/" })}
            />
          ) : (
            <p className="text-muted-foreground text-sm">正在打开 Runner…</p>
          )}
        </div>
      </div>
    </section>
  );
}
