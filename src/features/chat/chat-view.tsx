import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  InfoIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

import { useWorkspaceContext } from "@/app/workspace-provider";
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
import { useBotTimeline } from "@/features/chat/use-bot-timeline";

export function ChatView({ botId }: { botId: string }) {
  const workspace = useWorkspaceContext();
  const { selection, connection, feedback, messaging, conversation, actions } = workspace;
  const navigate = useNavigate();
  const messagesRef = useRef<HTMLDivElement>(null);
  const segments = useBotTimeline(selection.botConversations, {
    id: selection.conversationId,
    snapshot: selection.snapshot,
  });
  const lastMessageId = selection.snapshot?.messages.at(-1)?.id;
  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [selection.conversationId, lastMessageId]);
  const hasConversation = selection.conversationId !== null;
  const executionStatus = conversation.executing
    ? "执行中"
    : conversation.hasLiveTasks
      ? "等待中"
      : "空闲";
  const model =
    selection.snapshot?.conversation.agent.model?.modelId ?? selection.activeBot?.model.modelId;
  return (
    <section aria-label="聊天内容" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-3 md:px-4">
        <Button
          aria-label="返回 Bot 列表"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => void navigate({ to: "/" })}
        >
          <ChevronLeftIcon />
        </Button>
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <h1 className="truncate text-sm font-semibold">
            {selection.activeBot?.name ?? "AgentChat"}
          </h1>
          <p className="text-muted-foreground truncate text-xs">
            {model ?? "Runner"} · 本机
            {hasConversation ? ` · ${executionStatus}` : ""}
          </p>
        </div>
        {conversation.hasLiveTasks && (
          <Button
            disabled={connection.busy}
            size="sm"
            variant="outline"
            onClick={() => void messaging.abort()}
          >
            <SquareIcon />
            停止
          </Button>
        )}
        <Button
          aria-label="查看 Bot 详情"
          title="详情"
          variant="ghost"
          size="icon-sm"
          className="xl:hidden"
          onClick={() => void navigate({ to: "/bots/$botId/details", params: { botId } })}
        >
          <InfoIcon />
        </Button>
      </header>
      {(feedback.error || connection.credentialWarning) && (
        <div
          role="alert"
          className="text-destructive flex items-center justify-between gap-2 border-b px-5 py-3 text-sm"
        >
          <span>{feedback.error || connection.credentialWarning}</span>
          {connection.runnerUnavailable && (
            <Button
              size="sm"
              variant="outline"
              disabled={connection.busy}
              onClick={() => void actions.restartRunner()}
            >
              重新连接
            </Button>
          )}
        </div>
      )}
      {feedback.notice && (
        <div
          role="status"
          className="text-muted-foreground flex items-center justify-between gap-2 border-b px-5 py-2 text-xs"
        >
          <span>{feedback.notice}</span>
          <Button
            aria-label="关闭提示"
            variant="ghost"
            size="icon-xs"
            onClick={() => feedback.dismissNotice()}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {hasConversation && !connection.providerConfigured && (
        <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-5 py-2 text-xs">
          <span>尚未检测到 DeepSeek 凭据。</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigate({ to: "/settings/$section", params: { section: "provider" } })
            }
          >
            配置密钥
          </Button>
        </div>
      )}
      <div
        ref={messagesRef}
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {segments.map((segment, index) => (
            <Fragment key={segment.conversation.id}>
              <p className="text-muted-foreground text-center text-xs">
                {index === 0
                  ? formatDate(segment.conversation.createdAt)
                  : `新会话 · ${formatDate(segment.conversation.createdAt)}`}
              </p>
              {segment.snapshot.messages
                .filter((message) => message.text)
                .map((message) => (
                  <Message key={message.id} align={message.role === "user" ? "end" : "start"}>
                    <MessageContent>
                      <MessageHeader>
                        {message.role === "user"
                          ? "你"
                          : message.role === "assistant"
                            ? segment.snapshot.conversation.botName
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
            </Fragment>
          ))}
          {!hasConversation && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
              <Avatar size="lg">
                <AvatarFallback>
                  <SparklesIcon />
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="font-medium">
                  {selection.activeBot
                    ? `和${selection.activeBot.name}聊聊`
                    : "有什么想一起完成的？"}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">使用 DeepSeek，开始一次对话。</p>
              </div>
              <Button
                disabled={connection.busy || connection.runnerUnavailable || !connection.ready}
                onClick={() => void actions.startConversation(botId)}
              >
                开始新对话
              </Button>
            </div>
          )}
          {hasConversation &&
            segments.every((segment) => segment.snapshot.messages.length === 0) && (
              <p className="text-muted-foreground text-center text-sm">
                输入第一条消息，开始这次对话。
              </p>
            )}
          {messaging.pendingSubmission?.conversationId === selection.conversationId && (
            <p className="text-muted-foreground text-xs">正在发送消息…</p>
          )}
          {messaging.currentAcceptedSubmissionId !== null && (
            <p className="text-muted-foreground text-xs">
              消息已发送
              {messaging.acceptedSubmissionStatus?.status === "queued" ? " · 排队中" : ""}
            </p>
          )}
          {selection.snapshot?.submissions
            .filter((submission) => submission.status === "queued")
            .map((submission) => (
              <div key={submission.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">消息 #{submission.id} 等待处理</span>
                {submission.type === "input" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={connection.busy}
                    onClick={() => void messaging.withdrawSubmission(submission.id)}
                  >
                    撤回
                  </Button>
                )}
              </div>
            ))}
          {conversation.hasLiveTasks && (
            <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner />
              {conversation.executing ? "正在思考与执行…" : "等待处理…"}
            </p>
          )}
        </div>
      </div>
      <form
        className="px-5 pt-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void messaging.submitMessage();
        }}
      >
        <InputGroup className="mx-auto max-w-3xl">
          <InputGroupTextarea
            aria-label="发送消息"
            className="max-h-40 min-h-16"
            disabled={
              !hasConversation ||
              connection.busy ||
              connection.runnerUnavailable ||
              !connection.ready ||
              messaging.pendingSubmission !== null
            }
            placeholder={`发送消息给 ${selection.activeBot?.name ?? "Bot"}`}
            value={messaging.input}
            onChange={(event) => messaging.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <span className="text-muted-foreground flex-1 px-2 text-xs">
              Enter 发送 · Shift + Enter 换行
            </span>
            <InputGroupButton
              aria-label={messaging.pendingSubmission ? "重试" : "发送"}
              size="icon-sm"
              variant="default"
              type="submit"
              disabled={
                !hasConversation ||
                connection.busy ||
                connection.runnerUnavailable ||
                !connection.ready ||
                !messaging.input.trim() ||
                (messaging.pendingSubmission !== null &&
                  messaging.pendingSubmission.conversationId !== selection.conversationId)
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
