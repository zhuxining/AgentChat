import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, SparklesIcon } from "lucide-react";

import { useWorkspaceContext } from "@/app/workspace-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoRow, InspectorSection } from "@/components/ui/inspector-section";
import { Separator } from "@/components/ui/separator";
import { GoalEditor } from "@/features/bots/goal-editor";

export function BotDetailsPane() {
  const { selection, connection, conversation, actions } = useWorkspaceContext();
  const navigate = useNavigate();
  const bot = selection.activeBot;
  const snapshot = selection.snapshot;
  return (
    <aside
      aria-label="Bot 详情"
      className="bg-sidebar flex w-72 shrink-0 flex-col border-l xl:w-80"
    >
      <header className="flex h-16 shrink-0 items-center border-b px-5">
        <h2 className="text-sm font-medium">Bot 详情</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <Card size="sm">
          <CardContent className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback>
                <SparklesIcon />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">{bot?.name ?? "未选择 Bot"}</p>
              <p className="text-muted-foreground text-xs">
                {snapshot?.conversation.agent.model?.provider ?? bot?.model.provider ?? "Runner"} ·
                本机
              </p>
            </div>
          </CardContent>
        </Card>
        <InspectorSection title="配置摘要">
          <Card size="sm">
            <CardContent className="space-y-3">
              <InfoRow
                label="模型"
                value={snapshot?.conversation.agent.model?.modelId ?? bot?.model.modelId ?? "—"}
              />
              <Separator />
              <InfoRow
                label="工作区"
                value={
                  <span className="break-all">
                    {snapshot?.conversation.agent.cwd || bot?.cwd || "应用默认目录"}
                  </span>
                }
              />
              <Separator />
              <InfoRow
                label="工具"
                value={
                  (snapshot?.conversation.agent.tools ?? bot?.tools ?? []).join("、") || "未启用"
                }
              />
              {bot && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() =>
                    void navigate({ to: "/bots/$botId/details", params: { botId: bot.id } })
                  }
                >
                  查看完整配置
                  <ChevronRightIcon />
                </Button>
              )}
            </CardContent>
          </Card>
        </InspectorSection>
        {snapshot && (
          <InspectorSection title="当前对话">
            <Card size="sm">
              <CardContent className="space-y-3">
                <InfoRow
                  label="状态"
                  value={
                    conversation.executing
                      ? "执行中"
                      : conversation.hasLiveTasks
                        ? "等待中"
                        : "空闲"
                  }
                />
                <Separator />
                <InfoRow label="会话" value={`共 ${selection.botConversations.length} 段`} />
                {conversation.hasUpdatedBotSettings && (
                  <Button
                    className="w-full"
                    variant="outline"
                    size="sm"
                    disabled={
                      connection.busy || connection.runnerUnavailable || conversation.hasLiveTasks
                    }
                    onClick={() => void actions.applyBotSettings()}
                  >
                    应用最新 Bot 设置
                  </Button>
                )}
              </CardContent>
            </Card>
          </InspectorSection>
        )}
        {snapshot && (
          <InspectorSection title="工作目标">
            <GoalEditor />
          </InspectorSection>
        )}
      </div>
    </aside>
  );
}
