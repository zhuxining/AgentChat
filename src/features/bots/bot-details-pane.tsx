import { cn } from "cn";

import { useWorkspaceUi } from "@/app/workspace-ui";
import { BotDetailsView } from "@/features/bots/bot-details-view";

export function BotDetailsPane() {
  const { botListOpen } = useWorkspaceUi();
  return (
    <aside
      aria-label="Bot 详情"
      className="bg-sidebar flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <header
        className={cn("flex h-16 shrink-0 items-center border-b px-5", !botListOpen && "pr-14")}
      >
        <h2 className="text-sm font-medium">Bot 详情</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <BotDetailsView showFeedback={false} />
      </div>
    </aside>
  );
}
