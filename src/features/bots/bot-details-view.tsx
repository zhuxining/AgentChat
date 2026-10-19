import { useNavigate } from "@tanstack/react-router";
import { SparklesIcon, WrenchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BotDraft } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { initializeBotDraft } from "@/features/bots/bot-draft";
import { BotModelSelect } from "@/features/bots/bot-model-select";
import { CapabilityFields } from "@/features/bots/capability-fields";
import { GoalEditor } from "@/features/bots/goal-editor";
import { useBotChat } from "@/features/chat/use-bot-chat";

const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh"] as const;

type EditState =
  | { kind: "instructions"; value: string }
  | { kind: "cwd"; value: string }
  | { kind: "capabilities"; extensions: string[]; tools: string[] }
  | { kind: "archive" }
  | null;

// Detail content is shared by the wide-screen pane and the standalone page. Simple values
// change inline; anything with real editing volume opens a dialog instead of a separate page.
// Operations report errors where they were initiated, including the desktop pane.
export function BotDetailsView() {
  const { catalog, selection, connection, conversation, operationError, actions } = useBotChat();
  const navigate = useNavigate();
  const [edit, setEdit] = useState<EditState>(null);
  const bot = selection.activeBot;
  const snapshot = selection.snapshot;
  const snapshotUnavailable =
    selection.conversationId !== null &&
    snapshot === null &&
    (Boolean(selection.snapshotError) || connection.runnerUnavailable);
  const disabled = connection.busy || connection.runnerUnavailable;

  if (!bot) {
    return (
      <Empty className="min-h-40 p-4">
        <EmptyHeader>
          <EmptyTitle className="text-sm">未选择 Bot</EmptyTitle>
          <EmptyDescription>从列表选择一个 Bot 查看详情。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  async function save(patch: Partial<BotDraft>) {
    if (!bot || !catalog.botDefaults) return;
    await actions.saveBot(
      bot.id,
      { ...initializeBotDraft(bot, catalog.botDefaults), ...patch },
      bot.configVersion,
    );
  }

  const provider = catalog.providers.find((item) => item.name === bot.model.provider);

  return (
    <div className="space-y-5">
      {operationError && (
        <Alert variant="destructive" className="animate-fade-in">
          <AlertDescription>{operationError}</AlertDescription>
        </Alert>
      )}
      <Item variant="outline" className="bg-card rounded-xl">
        <ItemMedia>
          <Avatar size="lg">
            <AvatarFallback>
              <SparklesIcon />
            </AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{bot.name}</ItemTitle>
          <ItemDescription className="text-xs">
            {provider?.label ?? bot.model.provider} · {bot.model.modelId}
          </ItemDescription>
        </ItemContent>
      </Item>

      <DetailsGroup title="资料">
        <DetailsRow label="名称">
          <Input
            key={bot.configVersion}
            aria-label="Bot 名称"
            className="h-7 w-40 text-right text-xs"
            defaultValue={bot.name}
            disabled={disabled}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== bot?.name) void save({ name: value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </DetailsRow>
        <DetailsRow label="指令">
          <Button
            aria-label="编辑指令"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setEdit({ kind: "instructions", value: bot.instructions })}
          >
            {bot.instructions ? "编辑…" : "添加…"}
          </Button>
        </DetailsRow>
        {bot.instructions && (
          <p className="text-muted-foreground line-clamp-3 px-3 py-2 text-xs whitespace-pre-wrap">
            {bot.instructions}
          </p>
        )}
      </DetailsGroup>

      <DetailsGroup title="运行方式">
        <DetailsRow label="服务商">
          <NativeSelect
            aria-label="服务商"
            className="w-40"
            size="sm"
            value={bot.model.provider}
            disabled={disabled || catalog.providers.length === 0}
            onChange={(event) => {
              const next = catalog.providers.find((item) => item.name === event.target.value);
              void save({
                provider: event.target.value,
                modelId: next?.models[0] ?? bot.model.modelId,
              });
            }}
          >
            {catalog.providers.length === 0 && (
              <NativeSelectOption value={bot.model.provider}>
                {bot.model.provider}
              </NativeSelectOption>
            )}
            {catalog.providers.map((item) => (
              <NativeSelectOption key={item.name} value={item.name}>
                {item.label ?? item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </DetailsRow>
        <DetailsRow label="模型">
          <div className="w-40">
            <BotModelSelect
              providers={catalog.providers}
              provider={bot.model.provider}
              modelId={bot.model.modelId}
              disabled={disabled}
              onChange={(provider, modelId) => void save({ provider, modelId })}
            />
          </div>
        </DetailsRow>
        <DetailsRow label="思考级别">
          <NativeSelect
            aria-label="思考级别"
            className="w-40"
            size="sm"
            value={bot.thinkingLevel}
            disabled={disabled}
            onChange={(event) =>
              void save({ thinkingLevel: event.target.value as BotDraft["thinkingLevel"] })
            }
          >
            {thinkingLevels.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {level}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </DetailsRow>
        <DetailsRow label="凭证">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigate({ to: "/settings/$section", params: { section: "provider" } })
            }
          >
            {connection.providerConfigured ? "更改…" : "设置…"}
          </Button>
        </DetailsRow>
        <DetailsRow label="工作目录">
          <Button
            aria-label="编辑工作目录"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setEdit({ kind: "cwd", value: bot.cwd })}
          >
            {bot.cwd ? "编辑…" : "使用默认"}
          </Button>
        </DetailsRow>
        <p className="text-muted-foreground px-3 py-2 text-xs break-all">
          {bot.cwd || "应用默认工作区"}
        </p>
      </DetailsGroup>

      <DetailsGroup title="能力">
        <DetailsRow label="扩展">
          <span className="truncate text-xs">{bot.extensions.join("、") || "无"}</span>
        </DetailsRow>
        <DetailsRow label="工具">
          <span className="truncate text-xs">{bot.tools.join("、") || "无"}</span>
        </DetailsRow>
        <DetailsRow label="访问权限">
          <Button
            aria-label="配置能力"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() =>
              setEdit({
                kind: "capabilities",
                extensions: [...bot.extensions],
                tools: [...bot.tools],
              })
            }
          >
            <WrenchIcon />
            配置…
          </Button>
        </DetailsRow>
      </DetailsGroup>

      {selection.conversationId !== null && (
        <DetailsGroup title="当前对话">
          {snapshot ? (
            <>
              <DetailsRow label="状态">
                <span className="text-xs">
                  {conversation.executing
                    ? "执行中"
                    : conversation.hasLiveTasks
                      ? "等待中"
                      : "空闲"}
                </span>
              </DetailsRow>
              <DetailsRow label="会话">
                <span className="text-xs">共 {selection.botConversations.length} 段</span>
              </DetailsRow>
              <div className="space-y-2 px-3 py-2">
                <p className="text-muted-foreground text-xs">工作目标</p>
                <GoalEditor />
              </div>
              {conversation.hasUpdatedBotSettings && (
                <div className="px-3 py-2">
                  <Button
                    className="w-full"
                    variant="outline"
                    size="sm"
                    disabled={disabled || conversation.hasLiveTasks}
                    onClick={() => void actions.applyBotSettings()}
                  >
                    应用最新 Bot 设置
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div
              role="status"
              aria-label={snapshotUnavailable ? "会话读取失败" : "正在加载会话"}
              className="space-y-2 px-3 py-3"
            >
              <p className="text-muted-foreground text-xs">
                {snapshotUnavailable ? "会话读取失败" : "正在加载会话…"}
              </p>
              <DetailsRow label="状态">
                <Skeleton className="h-4 w-14" />
              </DetailsRow>
              <DetailsRow label="会话">
                <Skeleton className="h-4 w-10" />
              </DetailsRow>
              <div className="space-y-2 px-3 py-2">
                <p className="text-muted-foreground text-xs">工作目标</p>
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          )}
        </DetailsGroup>
      )}

      <DetailsGroup title="管理">
        <DetailsRow label="配置版本">
          <span className="truncate text-xs">{bot.configVersion}</span>
        </DetailsRow>
        <DetailsRow label="归档">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={disabled}
            onClick={() => setEdit({ kind: "archive" })}
          >
            归档 Bot…
          </Button>
        </DetailsRow>
      </DetailsGroup>

      <Dialog open={edit !== null} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {edit?.kind === "instructions" && (
            <>
              <DialogHeader>
                <DialogTitle>编辑指令</DialogTitle>
                <DialogDescription>
                  指令决定 Bot 的行为方式，保存后只影响新建对话；已有对话需显式应用。
                </DialogDescription>
              </DialogHeader>
              <Textarea
                aria-label="指令"
                className="min-h-40 resize-y"
                value={edit.value}
                onChange={(event) => setEdit({ kind: "instructions", value: event.target.value })}
              />
              <DialogFooter>
                <Button
                  disabled={connection.busy}
                  onClick={async () => {
                    await save({ instructions: edit.value });
                    setEdit(null);
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </>
          )}
          {edit?.kind === "cwd" && (
            <>
              <DialogHeader>
                <DialogTitle>编辑工作目录</DialogTitle>
                <DialogDescription>
                  留空时使用应用默认工作区。cwd 只是执行位置，不是文件访问隔离。
                </DialogDescription>
              </DialogHeader>
              <Input
                aria-label="默认工作目录"
                value={edit.value}
                onChange={(event) => setEdit({ kind: "cwd", value: event.target.value })}
              />
              <DialogFooter>
                <Button
                  disabled={connection.busy}
                  onClick={async () => {
                    await save({ cwd: edit.value });
                    setEdit(null);
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </>
          )}
          {edit?.kind === "capabilities" && (
            <>
              <DialogHeader>
                <DialogTitle>配置能力</DialogTitle>
                <DialogDescription>取消选择 Extension 会同时移除它提供的工具。</DialogDescription>
              </DialogHeader>
              <CapabilityFields
                capabilities={catalog.capabilities}
                extensions={edit.extensions}
                tools={edit.tools}
                onChange={(next) => setEdit({ kind: "capabilities", ...next })}
              />
              <DialogFooter>
                <Button
                  disabled={connection.busy}
                  onClick={async () => {
                    await save({ extensions: edit.extensions, tools: edit.tools });
                    setEdit(null);
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </>
          )}
          {edit?.kind === "archive" && (
            <>
              <DialogHeader>
                <DialogTitle>归档 Bot</DialogTitle>
                <DialogDescription>
                  {bot.name} 将从列表移除，已有对话与工作区保留；归档不会取消正在运行的工作。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={connection.busy} onClick={() => setEdit(null)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={connection.busy}
                  onClick={async () => {
                    const archived = await actions.archiveBot(bot);
                    setEdit(null);
                    if (archived) void navigate({ to: "/" });
                  }}
                >
                  归档
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground px-1 text-xs font-medium">{title}</h2>
      <div className="bg-card divide-y overflow-hidden rounded-xl border">{children}</div>
    </section>
  );
}

function DetailsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}
