import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  PanelRightIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import { Fragment } from "react";

import { useWorkspaceContext } from "@/app/workspace-provider";
import { useWorkspaceUi } from "@/app/workspace-ui";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/features/chat/format-date";
import { useBotTimeline } from "@/features/chat/use-bot-timeline";
import { useMediaQuery } from "@/hooks/use-media-query";

// Message ids are only unique inside a library Conversation, so rows are addressed by
// conversation and message together once several conversations share one transcript.
function rowId(conversationId: number, messageId: number) {
  return `${conversationId}:${messageId}`;
}

export function ChatView({ botId }: { botId: string }) {
  const workspace = useWorkspaceContext();
  const { selection, connection, feedback, messaging, conversation, actions } = workspace;
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { detailsOpen, toggleDetails } = useWorkspaceUi();
  const segments = useBotTimeline(selection.botConversations, {
    id: selection.conversationId,
    snapshot: selection.snapshot,
  });
  const hasConversation = selection.conversationId !== null;
  const executionStatus = conversation.executing
    ? "执行中"
    : conversation.hasLiveTasks
      ? "等待中"
      : "空闲";
  const model =
    selection.snapshot?.conversation.agent.model?.modelId ?? selection.activeBot?.model.modelId;
  return (
    <section aria-label="聊天内容" className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
          aria-label={
            isDesktop ? (detailsOpen ? "收起 Bot 详情" : "展开 Bot 详情") : "查看 Bot 详情"
          }
          title="详情"
          variant="ghost"
          size="icon-sm"
          aria-expanded={isDesktop ? detailsOpen : undefined}
          onClick={() =>
            isDesktop
              ? toggleDetails()
              : void navigate({ to: "/bots/$botId/details", params: { botId } })
          }
        >
          <PanelRightIcon />
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
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-5">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl py-6">
              {segments.map((segment, index) => (
                <Fragment key={segment.conversation.id}>
                  <MessageScrollerItem messageId={`conversation:${segment.conversation.id}`}>
                    <Marker variant="separator">
                      <MarkerContent>
                        {index === 0
                          ? formatDate(segment.conversation.createdAt)
                          : `新会话 · ${formatDate(segment.conversation.createdAt)}`}
                      </MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                  {segment.snapshot.messages
                    .filter(
                      (message) =>
                        message.text && (message.role === "user" || message.role === "assistant"),
                    )
                    .map((message) => (
                      <MessageScrollerItem
                        key={rowId(segment.conversation.id, message.id)}
                        messageId={rowId(segment.conversation.id, message.id)}
                        scrollAnchor={message.role === "user"}
                      >
                        <Message align={message.role === "user" ? "end" : "start"}>
                          <MessageContent>
                            <Bubble
                              align={message.role === "user" ? "end" : "start"}
                              variant={message.role === "user" ? "default" : "muted"}
                            >
                              <BubbleContent className="whitespace-pre-wrap">
                                {message.text}
                                {message.truncated && (
                                  <span className="text-muted-foreground">（内容已截断）</span>
                                )}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                </Fragment>
              ))}
              {!hasConversation && (
                <MessageScrollerItem messageId="empty">
                  <Empty className="min-h-64">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SparklesIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        {selection.activeBot
                          ? `和${selection.activeBot.name}聊聊`
                          : "有什么想一起完成的？"}
                      </EmptyTitle>
                      <EmptyDescription>使用 DeepSeek，开始一次对话。</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        disabled={
                          connection.busy || connection.runnerUnavailable || !connection.ready
                        }
                        onClick={() => void actions.startConversation(botId)}
                      >
                        开始新对话
                      </Button>
                    </EmptyContent>
                  </Empty>
                </MessageScrollerItem>
              )}
              {hasConversation &&
                segments.every((segment) => segment.snapshot.messages.length === 0) && (
                  <MessageScrollerItem messageId="empty-conversation">
                    <Empty className="min-h-40">
                      <EmptyHeader>
                        <EmptyTitle>开始这次对话</EmptyTitle>
                        <EmptyDescription>输入第一条消息，Bot 会接着往下做。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </MessageScrollerItem>
                )}
              {messaging.pendingSubmission?.conversationId === selection.conversationId && (
                <MessageScrollerItem messageId="status:pending">
                  <Marker role="status">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>正在发送消息…</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {messaging.currentAcceptedSubmissionId !== null && (
                <MessageScrollerItem messageId="status:accepted">
                  <Marker role="status">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>
                      消息已发送
                      {messaging.acceptedSubmissionStatus?.status === "queued" ? " · 排队中" : ""}
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {selection.snapshot?.submissions
                .filter((submission) => submission.status === "queued")
                .map((submission) => (
                  <MessageScrollerItem
                    key={`submission:${submission.id}`}
                    messageId={`submission:${submission.id}`}
                  >
                    <Marker>
                      <MarkerContent className="flex-1">
                        消息 #{submission.id} 等待处理
                      </MarkerContent>
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
                    </Marker>
                  </MessageScrollerItem>
                ))}
              {conversation.hasLiveTasks && (
                <MessageScrollerItem messageId="status:running">
                  <Marker role="status">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent className="shimmer">
                      {conversation.executing ? "正在思考与执行…" : "等待处理…"}
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton>
            <ArrowDownIcon />
            <span className="sr-only">跳到最新消息</span>
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
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
