import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BotDetailsView } from "@/features/bots/bot-details-view";

export function BotDetailsPage({ botId }: { botId: string }) {
  const navigate = useNavigate();
  return (
    <section
      aria-label="Bot 详情"
      className="animate-fade-in flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <header
        data-window-titlebar
        className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4"
      >
        <Button
          aria-label="返回聊天"
          variant="ghost"
          size="icon-sm"
          onClick={() => void navigate({ to: "/bots/$botId", params: { botId } })}
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" data-window-drag-region>
          Bot 详情
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-2xl">
          <BotDetailsView />
        </div>
      </div>
    </section>
  );
}
