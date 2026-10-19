import { BotDetailsView } from "@/features/bots/bot-details-view";

export function BotDetailsPane() {
  return (
    <aside
      aria-label="Bot 详情"
      className="bg-sidebar flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <header className="flex h-14 shrink-0 items-center px-5">
        <h2 className="text-sm font-medium">Bot 详情</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <BotDetailsView />
      </div>
    </aside>
  );
}
