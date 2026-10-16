import { PanelRightIcon, PlusIcon, SparklesIcon, WrenchIcon } from "lucide-react";

import type { Bot } from "@/app/runner-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { InspectorSection, InfoRow } from "@/features/chat/inspector-section";
import type { Workspace } from "@/features/chat/use-workspace";

type Props = {
  selection: Pick<Workspace["selection"], "activeBot" | "snapshot">;
  connection: Pick<Workspace["connection"], "busy" | "providerConfigured" | "runnerUnavailable">;
  conversation: Workspace["conversation"];
  actions: Pick<Workspace["actions"], "applyBotSettings" | "saveGoal" | "setGoalStatus">;
  onEditBot: (bot: Bot) => void;
  onSettings: () => void;
  onClose: () => void;
};

export function BotInspector({
  selection: { activeBot, snapshot },
  connection: { busy, providerConfigured, runnerUnavailable },
  conversation: { hasLiveTasks, hasUpdatedBotSettings, goalDraft, setGoalDraft },
  actions: { applyBotSettings, saveGoal, setGoalStatus },
  onEditBot,
  onSettings,
  onClose,
}: Props) {
  return (
    <aside
      aria-label="智能体资料"
      className="bg-sidebar flex w-72 shrink-0 flex-col border-l xl:w-80"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-5">
        <h2 className="text-sm font-medium">聊天信息</h2>
        <Button
          aria-label="关闭智能体资料"
          size="icon-sm"
          variant="ghost"
          onClick={() => onClose()}
        >
          <PanelRightIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <InspectorSection title="此聊天中的智能体">
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback>
                  <SparklesIcon />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{activeBot?.name ?? "未选择智能体"}</p>
                <p className="text-muted-foreground text-xs">
                  {activeBot?.model.provider ?? "Runner"} · 本机
                </p>
              </div>
            </CardContent>
          </Card>
        </InspectorSection>
        <InspectorSection
          title="资料"
          action={
            activeBot && !activeBot.archived ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onEditBot(activeBot);
                }}
              >
                编辑
              </Button>
            ) : undefined
          }
        >
          <Card size="sm">
            <CardContent className="space-y-3">
              <InfoRow label="名称" value={activeBot?.name ?? "—"} />
              <InfoRow
                label="配置版本"
                value={<span className="break-all">{activeBot?.configVersion ?? "—"}</span>}
              />
              <Separator />
              <div>
                <p className="text-muted-foreground mb-2 text-xs">描述</p>
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {activeBot?.instructions || "尚未设置描述"}
                </p>
              </div>
              <Separator />
              <InfoRow
                label="访问权限"
                value={activeBot?.tools.length ? "已启用本机工具" : "仅聊天"}
              />
              <p className="text-muted-foreground text-xs">工作目录不是文件访问隔离。</p>
            </CardContent>
          </Card>
        </InspectorSection>
        <InspectorSection title="运行方式">
          <Card size="sm">
            <CardContent className="space-y-3">
              <InfoRow
                label="服务商"
                value={
                  snapshot?.conversation.agent.model?.provider ?? activeBot?.model.provider ?? "—"
                }
              />
              <Separator />
              <InfoRow
                label="模型"
                value={
                  snapshot?.conversation.agent.model?.modelId ??
                  activeBot?.model.modelId ??
                  "deepseek-chat"
                }
              />
              <Separator />
              <InfoRow
                label="思考"
                value={
                  (snapshot?.conversation.agent.model?.modelId ?? activeBot?.model.modelId) ===
                  "deepseek-reasoner"
                    ? "深度思考"
                    : "标准"
                }
              />
              <Separator />
              <InfoRow
                label="凭证"
                value={
                  <Button variant="ghost" size="sm" onClick={() => onSettings()}>
                    {providerConfigured ? "已配置 · 更改" : "设置密钥"}
                  </Button>
                }
              />
              <Separator />
              <div>
                <p className="text-muted-foreground mb-2 text-xs">工作目录</p>
                <p className="text-xs leading-5 break-all">
                  {snapshot?.conversation.agent.cwd || activeBot?.cwd || "应用默认目录"}
                </p>
              </div>
              {hasUpdatedBotSettings && (
                <Button
                  className="w-full"
                  variant="outline"
                  size="sm"
                  disabled={busy || runnerUnavailable || hasLiveTasks}
                  onClick={() => void applyBotSettings()}
                >
                  应用最新智能体设置
                </Button>
              )}
            </CardContent>
          </Card>
        </InspectorSection>
        {snapshot && (
          <InspectorSection title="工作目标">
            <Card size="sm">
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveGoal();
                  }}
                >
                  <Textarea
                    aria-label="工作目标"
                    placeholder="记录这次聊天要完成的工作"
                    value={goalDraft}
                    onChange={(event) => setGoalDraft(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      type="submit"
                      disabled={
                        busy || runnerUnavailable || goalDraft === snapshot.goal.description
                      }
                    >
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || runnerUnavailable || !snapshot.goal.description.trim()}
                      onClick={() =>
                        void setGoalStatus(snapshot.goal.status === "open" ? "completed" : "open")
                      }
                    >
                      {snapshot.goal.status === "open" ? "确认完成" : "重新打开"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </InspectorSection>
        )}
        <InspectorSection
          title="技能与工具"
          action={
            activeBot && !activeBot.archived ? (
              <Button
                aria-label="配置技能与工具"
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  onEditBot(activeBot);
                }}
              >
                <PlusIcon />
              </Button>
            ) : undefined
          }
        >
          <Card size="sm">
            <CardContent className="space-y-3">
              {(snapshot?.conversation.agent.tools ?? activeBot?.tools ?? []).map((tool) => (
                <div className="flex items-center gap-2 text-sm" key={tool}>
                  <WrenchIcon className="text-muted-foreground size-4" />
                  {tool}
                </div>
              ))}
              {!(snapshot?.conversation.agent.tools ?? activeBot?.tools)?.length && (
                <p className="text-muted-foreground text-sm">未启用工具</p>
              )}
            </CardContent>
          </Card>
        </InspectorSection>
      </div>
    </aside>
  );
}
