import {
  ArrowUpIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/features/chat/format-date";
import type { Workspace } from "@/features/chat/use-workspace";

type Props = {
  selection: Pick<Workspace["selection"], "conversationId" | "snapshot">;
  connection: Pick<
    Workspace["connection"],
    "busy" | "runnerUnavailable" | "ready" | "providerConfigured" | "credentialWarning"
  >;
  feedback: Workspace["feedback"];
  messaging: Workspace["messaging"];
  execution: Pick<Workspace["conversation"], "hasLiveTasks" | "executing">;
  actions: Pick<Workspace["actions"], "startChat" | "restartRunner">;
  createdAt: number;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onSidebarOpen: () => void;
  onInspectorToggle: () => void;
  onInspectorOpen: () => void;
  onSettings: () => void;
};

export function ChatPanel({
  selection: { conversationId, snapshot },
  connection: { busy, runnerUnavailable, ready, providerConfigured, credentialWarning },
  feedback: { error, notice, dismissNotice },
  messaging: {
    input,
    setInput,
    pendingSubmission,
    currentAcceptedSubmissionId,
    acceptedSubmissionStatus,
    submitMessage,
    abort,
    withdrawSubmission,
  },
  execution: { hasLiveTasks, executing },
  actions: { startChat, restartRunner },
  createdAt,
  sidebarOpen,
  inspectorOpen,
  onSidebarOpen,
  onInspectorToggle,
  onInspectorOpen,
  onSettings,
}: Props) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastMessageId = snapshot?.messages.at(-1)?.id;
  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [conversationId, lastMessageId]);
  const executionStatus = executing ? "执行中" : hasLiveTasks ? "等待中" : "空闲";
  return (
    <section aria-label="聊天内容" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
        {!sidebarOpen && (
          <Button
            aria-label="展开会话列表"
            variant="ghost"
            size="icon-sm"
            onClick={() => onSidebarOpen()}
          >
            <PanelLeftIcon />
          </Button>
        )}
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <h1 className="truncate text-sm font-semibold">
            {snapshot?.conversation.botName ?? "AgentChat"}
          </h1>
          <p className="text-muted-foreground truncate text-xs">
            {snapshot?.conversation.agent.model?.provider ?? "Runner"} · 本机
            {snapshot ? ` · ${executionStatus}` : ""}
          </p>
        </div>
        {hasLiveTasks && (
          <Button disabled={busy} size="sm" variant="outline" onClick={() => void abort()}>
            <SquareIcon />
            停止
          </Button>
        )}
        <Button
          aria-label={inspectorOpen ? "收起智能体资料" : "展开智能体资料"}
          aria-expanded={inspectorOpen}
          variant="ghost"
          size="icon-sm"
          onClick={() => onInspectorToggle()}
        >
          <PanelRightIcon />
        </Button>
      </header>
      {(error || credentialWarning) && (
        <div
          role="alert"
          className="text-destructive flex items-center justify-between gap-2 border-b px-5 py-3 text-sm"
        >
          <span>{error || credentialWarning}</span>
          {runnerUnavailable && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void restartRunner()}
            >
              重新连接
            </Button>
          )}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="text-muted-foreground flex items-center justify-between gap-2 border-b px-5 py-2 text-xs"
        >
          <span>{notice}</span>
          <Button
            aria-label="关闭提示"
            variant="ghost"
            size="icon-xs"
            onClick={() => dismissNotice()}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {snapshot && !providerConfigured && (
        <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-5 py-2 text-xs">
          <span>尚未检测到 DeepSeek 凭据。</span>
          <Button variant="ghost" size="sm" onClick={() => onSettings()}>
            配置密钥
          </Button>
        </div>
      )}
      {snapshot &&
        snapshot.configurationErrors.missingExtensions.length +
          snapshot.configurationErrors.missingTools.length >
          0 && (
          <p role="alert" className="text-destructive border-b px-5 py-2 text-sm">
            当前配置中有不可用的能力，请编辑智能体并应用配置。
          </p>
        )}

      <div
        ref={messagesRef}
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {snapshot && (
            <p className="text-muted-foreground text-center text-xs">{formatDate(createdAt)}</p>
          )}
          {snapshot?.hasMoreMessages && (
            <p className="text-muted-foreground text-center text-xs">显示最近 50 条消息</p>
          )}
          {snapshot?.messages
            .filter((message) => message.text)
            .map((message) => (
              <Message key={message.id} align={message.role === "user" ? "end" : "start"}>
                <MessageContent>
                  <MessageHeader>
                    {message.role === "user"
                      ? "你"
                      : message.role === "assistant"
                        ? snapshot.conversation.botName
                        : message.role === "tool"
                          ? "工具"
                          : "系统"}
                  </MessageHeader>
                  <Card size="sm" className="w-fit max-w-[90%]">
                    <CardContent className="text-sm leading-7 break-words whitespace-pre-wrap">
                      {message.text}
                      {message.truncated && (
                        <span className="text-muted-foreground">（内容已截断）</span>
                      )}
                    </CardContent>
                  </Card>
                </MessageContent>
              </Message>
            ))}
          {(!snapshot || snapshot.messages.length === 0) && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
              <Avatar size="lg">
                <AvatarFallback>
                  <SparklesIcon />
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="font-medium">
                  {snapshot ? `和${snapshot.conversation.botName}聊聊` : "有什么想一起完成的？"}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">使用 DeepSeek，开始一次对话。</p>
              </div>
              {!snapshot && (
                <Button
                  disabled={busy || runnerUnavailable || !ready}
                  onClick={() => void startChat()}
                >
                  <PlusIcon />
                  开始聊天
                </Button>
              )}
            </div>
          )}
          {pendingSubmission?.conversationId === conversationId && (
            <p className="text-muted-foreground text-xs">正在发送消息…</p>
          )}
          {currentAcceptedSubmissionId !== null && (
            <p className="text-muted-foreground text-xs">
              消息已发送
              {acceptedSubmissionStatus?.status === "queued" ? " · 排队中" : ""}
            </p>
          )}
          {snapshot?.submissions
            .filter((submission) => submission.status === "queued")
            .map((submission) => (
              <div key={submission.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">消息 #{submission.id} 等待处理</span>
                {submission.type === "input" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void withdrawSubmission(submission.id)}
                  >
                    撤回
                  </Button>
                )}
              </div>
            ))}
          {hasLiveTasks && (
            <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner />
              {executing ? "正在思考与执行…" : "等待处理…"}
            </p>
          )}
        </div>
      </div>
      <form
        className="px-5 pt-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMessage();
        }}
      >
        <InputGroup className="mx-auto max-w-3xl">
          <InputGroupTextarea
            aria-label="发送消息"
            className="max-h-40 min-h-16"
            disabled={
              !snapshot || busy || runnerUnavailable || !ready || pendingSubmission !== null
            }
            placeholder={`发送消息给 ${snapshot?.conversation.botName ?? "智能体"}`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              aria-label="聊天设置"
              size="icon-sm"
              onClick={() => onInspectorOpen()}
            >
              <SlidersHorizontalIcon />
            </InputGroupButton>
            <span className="text-muted-foreground flex-1 text-xs">
              Enter 发送 · Shift + Enter 换行
            </span>
            <InputGroupButton
              aria-label={pendingSubmission ? "重试" : "发送"}
              size="icon-sm"
              variant="default"
              type="submit"
              disabled={
                !snapshot ||
                busy ||
                runnerUnavailable ||
                !ready ||
                !input.trim() ||
                (pendingSubmission !== null && pendingSubmission.conversationId !== conversationId)
              }
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}
