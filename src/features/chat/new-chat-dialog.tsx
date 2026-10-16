import { SparklesIcon } from "lucide-react";
import { useState } from "react";

import type { Bot } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  bots: Bot[];
  selectedBotId: string;
  busy: boolean;
  runnerUnavailable: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSelectBot: (id: string) => void;
  onStartChat: (cwd: string, goal: string) => Promise<boolean>;
  onNewBot: () => void;
};

export function NewChatDialog({
  open,
  bots,
  selectedBotId,
  busy,
  runnerUnavailable,
  error,
  onOpenChange,
  onSelectBot,
  onStartChat,
  onNewBot,
}: Props) {
  const [conversationCwd, setConversationCwd] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const selectedBot = bots.find((bot) => bot.id === selectedBotId && !bot.archived);
  async function startChat() {
    if (await onStartChat(conversationCwd, newGoal)) {
      setConversationCwd("");
      setNewGoal("");
      onOpenChange(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建聊天</DialogTitle>
          <DialogDescription>选择智能体，开始新的对话。</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {bots
            .filter((bot) => !bot.archived)
            .map((bot) => (
              <Button
                key={bot.id}
                className="w-full justify-start"
                variant={selectedBotId === bot.id ? "secondary" : "outline"}
                onClick={() => onSelectBot(bot.id)}
              >
                <SparklesIcon />
                {bot.name}
              </Button>
            ))}
        </div>
        <Input
          aria-label="Conversation 工作目录覆盖"
          placeholder="工作目录（可选）"
          value={conversationCwd}
          onChange={(event) => setConversationCwd(event.target.value)}
        />
        <Textarea
          aria-label="新 Conversation 工作目标"
          placeholder="工作目标（可选）"
          value={newGoal}
          onChange={(event) => setNewGoal(event.target.value)}
        />
        <Button disabled={busy || runnerUnavailable} onClick={() => void startChat()}>
          {selectedBot ? `和${selectedBot.name}聊天` : "创建默认助手并开始"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onOpenChange(false);
            onNewBot();
          }}
        >
          新建智能体
        </Button>
      </DialogContent>
    </Dialog>
  );
}
