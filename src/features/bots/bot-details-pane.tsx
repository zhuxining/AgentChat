import { BotDetailsView } from "@/features/bots/bot-details-view";

export function BotDetailsPane() {
  return (
    <aside
      aria-label="Bot 详情"
      className="bg-sidebar flex w-80 shrink-0 flex-col border-l xl:w-88"
    >
      <header className="flex h-16 shrink-0 items-center border-b px-5">
        <h2 className="text-sm font-medium">Bot 详情</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <BotDetailsView />
      </div>
    </aside>
  );
}
