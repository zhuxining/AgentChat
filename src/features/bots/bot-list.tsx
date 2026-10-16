import { PlusIcon, SearchIcon, SettingsIcon, SparklesIcon } from "lucide-react";

import type { Bot } from "@/app/runner-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { BotSummary } from "@/features/bots/use-bot-summaries";

type Props = {
  bots: Bot[];
  selectedBotId: string;
  summaries: Map<string, BotSummary>;
  search: string;
  busy: boolean;
  onSearchChange: (value: string) => void;
  onSelect: (botId: string) => void;
  onNewBot: () => void;
  onSettings: () => void;
};

export function BotList({
  bots,
  selectedBotId,
  summaries,
  search,
  busy,
  onSearchChange,
  onSelect,
  onNewBot,
  onSettings,
}: Props) {
  const active = bots.filter((bot) => !bot.archived);
  const query = search.trim().toLowerCase();
  const visible = query ? active.filter((bot) => bot.name.toLowerCase().includes(query)) : active;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-4">
        <span className="font-semibold" data-tauri-drag-region>
          AgentChat
        </span>
        <Button
          aria-label="新建 Bot"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => onNewBot()}
        >
          <PlusIcon />
        </Button>
      </header>
      <div className="px-3 pb-3">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索 Bot"
            placeholder="搜索 Bot"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </InputGroup>
      </div>
      <nav aria-label="Bot 列表" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
        {visible.map((bot) => (
          <BotListItem
            key={bot.id}
            bot={bot}
            selected={bot.id === selectedBotId}
            summary={summaries.get(bot.id)}
            onSelect={() => onSelect(bot.id)}
          />
        ))}
        {active.length === 0 && (
          <Empty className="min-h-40 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle className="text-sm">还没有 Bot</EmptyTitle>
              <EmptyDescription>点击右上角 + 创建第一个 Bot。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {active.length > 0 && visible.length === 0 && (
          <Empty className="min-h-32 p-4">
            <EmptyHeader>
              <EmptyTitle className="text-sm">没有找到匹配的 Bot</EmptyTitle>
              <EmptyDescription>试试其它关键词。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </nav>
      <footer className="flex items-center justify-between border-t p-3">
        <Button
          aria-label="应用设置"
          title="设置"
          variant="ghost"
          size="icon-sm"
          onClick={() => onSettings()}
        >
          <SettingsIcon />
        </Button>
      </footer>
    </div>
  );
}

function BotListItem({
  bot,
  selected,
  summary,
  onSelect,
}: {
  bot: Bot;
  selected: boolean;
  summary: BotSummary | undefined;
  onSelect: () => void;
}) {
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      className="h-auto w-full justify-start gap-3 py-3"
      onClick={onSelect}
    >
      <Avatar size="lg">
        <AvatarFallback>
          <SparklesIcon className="size-5" />
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{bot.name}</span>
          {summary?.executing && (
            <span
              role="img"
              aria-label="正在处理"
              className="bg-primary size-2 shrink-0 rounded-full"
            />
          )}
        </span>
        <span className="text-muted-foreground mt-1 block truncate text-xs">
          {summary?.executing ? "正在处理…" : summary?.latestMessage || "开始新的对话"}
        </span>
      </span>
    </Button>
  );
}
