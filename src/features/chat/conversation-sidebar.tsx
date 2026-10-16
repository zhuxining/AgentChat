import {
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";

import type { ConversationSummary } from "@/app/runner-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { formatDate } from "@/features/chat/format-date";

type Props = {
  conversations: ConversationSummary[];
  conversationId: number | null;
  latestMessage?: string;
  search: string;
  onSearchChange: (value: string) => void;
  busy: boolean;
  onSelect: (conversation: ConversationSummary) => void;
  onCollapse: () => void;
  onNewChat: () => void;
  onNewBot: () => void;
  onSettings: () => void;
};

export function ConversationSidebar({
  conversations,
  conversationId,
  latestMessage,
  search,
  onSearchChange,
  busy,
  onSelect,
  onCollapse,
  onNewChat,
  onNewBot,
  onSettings,
}: Props) {
  return (
    <aside
      aria-label="会话列表"
      className="bg-sidebar flex w-64 shrink-0 flex-col border-r xl:w-72"
    >
      <header className="flex h-16 shrink-0 items-center justify-between px-4">
        <span className="font-semibold" data-tauri-drag-region>
          AgentChat
        </span>
        <div className="flex gap-1">
          <Button
            aria-label="收起会话列表"
            variant="ghost"
            size="icon-sm"
            onClick={() => onCollapse()}
          >
            <PanelLeftIcon />
          </Button>
          <Button
            aria-label="新建聊天"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onNewChat()}
          >
            <PlusIcon />
          </Button>
        </div>
      </header>
      <div className="px-3 pb-3">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索会话"
            placeholder="搜索"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </InputGroup>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2" aria-label="聊天">
        {conversations
          .filter((item) => item.botName.toLowerCase().includes(search.toLowerCase()))
          .map((conversation) => (
            <Button
              key={conversation.id}
              variant={conversationId === conversation.id ? "secondary" : "ghost"}
              className="h-auto w-full justify-start gap-3 py-3"
              onClick={() => {
                onSelect(conversation);
              }}
            >
              <Avatar size="lg">
                <AvatarFallback>
                  <SparklesIcon className="size-5" />
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 text-left">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{conversation.botName}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(conversation.createdAt)}
                  </span>
                </span>
                <span className="text-muted-foreground mt-1 block truncate text-xs">
                  {conversationId === conversation.id
                    ? (latestMessage ?? "开始新的对话")
                    : "点击继续聊天"}
                </span>
              </span>
            </Button>
          ))}
        {conversations.length === 0 && (
          <p className="text-muted-foreground px-3 py-6 text-sm">还没有聊天，点击 + 开始。</p>
        )}
        {conversations.length > 0 &&
          !conversations.some((item) =>
            item.botName.toLowerCase().includes(search.toLowerCase()),
          ) && <p className="text-muted-foreground px-3 py-6 text-sm">没有找到匹配的会话。</p>}
      </nav>
      <footer className="flex items-center justify-between border-t p-3">
        <Button
          aria-label="设置"
          title="设置"
          variant="ghost"
          size="icon-sm"
          onClick={() => onSettings()}
        >
          <SettingsIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onNewBot();
          }}
        >
          <UsersIcon />
          智能体
        </Button>
      </footer>
    </aside>
  );
}
