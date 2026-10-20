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
import { useShallow } from "zustand/react/shallow";

import { useWorkspaceUi } from "@/app/workspace-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { MessageBody } from "@/features/chat/message-content";
import { useBotChat } from "@/features/chat/use-bot-chat";
import { useBotTimeline } from "@/features/chat/use-bot-timeline";
import { useMessageEntrance } from "@/features/chat/use-message-entrance";
import { useMediaQuery } from "@/hooks/use-media-query";

// Message ids are only unique inside a library Conversation, so rows are addressed by
// conversation and message together once several conversations share one transcript.
function rowId(conversationId: number, messageId: number) {
  return `${conversationId}:${messageId}`;
}

export function ChatView({ botId }: { botId: string }) {
  const workspace = useBotChat();
  const { selection, connection, feedback, messaging, actions } = workspace;
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { detailsOpen, toggleDetails, botListOpen } = useWorkspaceUi(
    useShallow((state) => ({
      detailsOpen: state.detailsOpen,
      toggleDetails: state.toggleDetails,
      botListOpen: state.botListOpen,
    })),
  );
  const { segments, hasOlder, historyLoading, loadOlder } = useBotTimeline(
    selection.botConversations,
    selection.conversationId,
    selection.snapshot,
  );
  const messageTexts = segments.flatMap((segment) =>
    segment.snapshot.messages.map((message) => message.text),
  );
  const latestSegment = segments.at(-1);
  const latestMessage = latestSegment?.snapshot.messages
    .filter((message) => message.text && (message.role === "user" || message.role === "assistant"))
    .at(-1);
  const latestRowId =
    latestSegment && latestMessage ? rowId(latestSegment.conversation.id, latestMessage.id) : null;
  const snapshot = selection.snapshot;
  const snapshotUnavailable =
    selection.conversationId !== null &&
    snapshot === null &&
    (Boolean(selection.snapshotError) || connection.runnerUnavailable);
  const snapshotLoading =
    selection.conversationId !== null && snapshot === null && !snapshotUnavailable;
  const hasLiveTasks = (snapshot?.activeTasks.length ?? 0) > 0;
  const executing = snapshot?.activeTasks.some((task) => task.status === "running") ?? false;
  const animatedRowId = useMessageEntrance(
    selection.conversationId,
    latestRowId,
    snapshot !== null,
  );
  const hasConversation = selection.conversationId !== null;
  const executionStatus = snapshot
    ? executing
      ? "执行中"
      : hasLiveTasks
        ? "等待中"
        : "空闲"
    : snapshotUnavailable
      ? "读取失败"
      : "正在加载";
  const model = snapshot?.conversation.agent.model?.modelId ?? selection.activeBot?.model.modelId;
  return (
    <section
      aria-label="聊天内容"
      className="animate-fade-in flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <header
        data-window-titlebar
        data-window-titlebar-leading={!botListOpen || undefined}
        className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-4"
      >
        <Button
          aria-label="返回 Bot 列表"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => void navigate({ to: "/" })}
        >
          <ChevronLeftIcon />
        </Button>
        <div className="min-w-0 flex-1" data-window-drag-region>
          <h1 className="truncate text-sm font-semibold">
            {selection.activeBot?.name ?? "AgentChat"}
          </h1>
          <p className="text-muted-foreground truncate text-xs">
            {model ?? "Runner"} · 本机
            {hasConversation ? ` · ${executionStatus}` : ""}
          </p>
        </div>
        {hasLiveTasks && (
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
          className="aria-expanded:bg-transparent hover:aria-expanded:bg-muted"
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
        <Alert variant="destructive" className="animate-fade-in rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center justify-between gap-2 px-5 py-3">
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
          </AlertDescription>
        </Alert>
      )}
      {hasConversation && !connection.providerConfigured && (
        <div className="text-muted-foreground animate-fade-in flex items-center justify-between gap-2 border-b px-5 py-2 text-xs">
          <span>尚未检测到 DeepSeek 凭据。</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigate({
                to: "/settings/$section",
                params: { section: "provider" },
                search: { returnBotId: botId },
              })
            }
          >
            配置密钥
          </Button>
        </div>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-5">
            <MessageScrollerContent
              aria-busy={hasLiveTasks || snapshotLoading}
              className="mx-auto w-full max-w-3xl py-6"
            >
              {hasOlder && (
                <div className="mb-4 flex justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={historyLoading || connection.runnerUnavailable}
                    onClick={loadOlder}
                  >
                    {historyLoading ? "正在加载更早对话…" : "加载更早对话"}
                  </Button>
                </div>
              )}
              {segments.map((segment, index) => (
                <Fragment key={segment.conversation.id}>
                  <MessageScrollerItem messageId={`conversation:${segment.conversation.id}`}>
                    <Marker variant="separator" className="animate-fade-in">
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
                        className={
                          rowId(segment.conversation.id, message.id) === animatedRowId
                            ? message.role === "user"
                              ? "animate-message-in-end"
                              : "animate-message-in"
                            : undefined
                        }
                      >
                        <MessageBody
                          message={message}
                          streaming={
                            rowId(segment.conversation.id, message.id) === latestRowId &&
                            hasLiveTasks
                          }
                          texts={messageTexts}
                        />
                      </MessageScrollerItem>
                    ))}
                </Fragment>
              ))}
              {!hasConversation && (
                <MessageScrollerItem messageId="empty">
                  <Empty className="animate-fade-in min-h-64">
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
              {snapshotLoading && (
                <MessageScrollerItem messageId="loading-conversation">
                  <Marker role="status" aria-label="正在加载会话">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>正在加载会话…</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {snapshotUnavailable && (
                <MessageScrollerItem messageId="unavailable-conversation">
                  <Marker role="status" aria-label="无法加载会话">
                    <MarkerContent>当前会话暂时无法加载。</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {hasConversation &&
                snapshot &&
                segments.every((segment) => segment.snapshot.messages.length === 0) && (
                  <MessageScrollerItem messageId="empty-conversation">
                    <Empty className="animate-fade-in min-h-40">
                      <EmptyHeader>
                        <EmptyTitle>开始这次对话</EmptyTitle>
                        <EmptyDescription>输入第一条消息，Bot 会接着往下做。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </MessageScrollerItem>
                )}
              {messaging.pendingSubmission?.conversationId === selection.conversationId && (
                <MessageScrollerItem messageId="status:pending">
                  <Marker role="status" className="animate-fade-in">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>正在发送消息…</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {snapshot?.submissions
                .filter((submission) => submission.status === "queued")
                .map((submission) => (
                  <MessageScrollerItem
                    key={`submission:${submission.id}`}
                    messageId={`submission:${submission.id}`}
                  >
                    <Marker className="animate-fade-in">
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
              {hasLiveTasks && (
                <MessageScrollerItem messageId="status:running">
                  <Marker role="status" className="animate-fade-in">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent className="shimmer">
                      {executing ? "正在思考与执行…" : "等待处理…"}
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
              messaging.pendingSubmission?.conversationId === selection.conversationId
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
          <InputGroupAddon align="block-end" className="pt-1">
            <InputGroupButton
              aria-label={messaging.pendingSubmission ? "重试" : "发送"}
              size="icon-sm"
              variant="default"
              type="submit"
              className="ml-auto"
              disabled={
                !hasConversation ||
                connection.busy ||
                connection.runnerUnavailable ||
                !connection.ready ||
                !messaging.input.trim() ||
                messaging.submitting ||
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
