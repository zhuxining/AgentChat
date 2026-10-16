import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, PencilIcon, SparklesIcon, WrenchIcon } from "lucide-react";

import { useWorkspaceContext } from "@/app/workspace-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoRow, InspectorSection } from "@/components/ui/inspector-section";
import { Separator } from "@/components/ui/separator";
import { GoalEditor } from "@/features/bots/goal-editor";

export function BotDetailsPage({ botId }: { botId: string }) {
  const { selection, connection, conversation, actions } = useWorkspaceContext();
  const navigate = useNavigate();
  const bot = selection.activeBot;
  const snapshot = selection.snapshot;
  const tools = snapshot?.conversation.agent.tools ?? bot?.tools ?? [];
  return (
    <section aria-label="Bot 详情" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-3 md:px-4">
        <Button
          aria-label="返回聊天"
          variant="ghost"
          size="icon-sm"
          onClick={() => void navigate({ to: "/bots/$botId", params: { botId } })}
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" data-tauri-drag-region>
          Bot 详情
        </h1>
        {bot && !bot.archived && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: "/bots/$botId/edit", params: { botId } })}
          >
            <PencilIcon />
            编辑配置
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
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
                  {bot?.model.provider ?? "Runner"} · 本机
                </p>
              </div>
            </CardContent>
          </Card>
          <InspectorSection title="资料">
            <Card size="sm">
              <CardContent className="space-y-3">
                <InfoRow label="名称" value={bot?.name ?? "—"} />
                <Separator />
                <InfoRow
                  label="配置版本"
                  value={<span className="break-all">{bot?.configVersion ?? "—"}</span>}
                />
                <Separator />
                <div>
                  <p className="text-muted-foreground mb-2 text-xs">指令</p>
                  <p className="text-sm leading-6 whitespace-pre-wrap">
                    {bot?.instructions || "尚未设置指令"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </InspectorSection>
          <InspectorSection title="运行方式">
            <Card size="sm">
              <CardContent className="space-y-3">
                <InfoRow
                  label="服务商"
                  value={snapshot?.conversation.agent.model?.provider ?? bot?.model.provider ?? "—"}
                />
                <Separator />
                <InfoRow
                  label="模型"
                  value={snapshot?.conversation.agent.model?.modelId ?? bot?.model.modelId ?? "—"}
                />
                <Separator />
                <InfoRow
                  label="凭证"
                  value={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void navigate({ to: "/settings/$section", params: { section: "provider" } })
                      }
                    >
                      {connection.providerConfigured ? "已配置 · 更改" : "设置密钥"}
                    </Button>
                  }
                />
                <Separator />
                <div>
                  <p className="text-muted-foreground mb-2 text-xs">工作目录</p>
                  <p className="text-xs leading-5 break-all">
                    {snapshot?.conversation.agent.cwd || bot?.cwd || "应用默认目录"}
                  </p>
                </div>
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
          <InspectorSection title="技能与工具">
            <Card size="sm">
              <CardContent className="space-y-3">
                {tools.map((tool) => (
                  <div className="flex items-center gap-2 text-sm" key={tool}>
                    <WrenchIcon className="text-muted-foreground size-4" />
                    {tool}
                  </div>
                ))}
                {tools.length === 0 && <p className="text-muted-foreground text-sm">未启用工具</p>}
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
                </CardContent>
              </Card>
            </InspectorSection>
          )}
          {snapshot && (
            <InspectorSection title="工作目标">
              <Card size="sm">
                <CardContent>
                  <GoalEditor />
                </CardContent>
              </Card>
            </InspectorSection>
          )}
        </div>
      </div>
    </section>
  );
}
