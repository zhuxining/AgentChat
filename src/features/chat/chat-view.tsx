import { useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  PanelRightIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useRef } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { MessageBody } from "@/features/chat/message-content";
import { useBotChat } from "@/features/chat/use-bot-chat";
import { useBotTimeline } from "@/features/chat/use-bot-timeline";
import { useMessageEntrance } from "@/features/chat/use-message-entrance";
import { useMediaQuery } from "@/hooks/use-media-query";

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KiB`;
  return `${size} B`;
}

const tokenFormatter = new Intl.NumberFormat("zh-CN");
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 4,
});

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
  const {
    messages,
    historyLoading,
    historyError,
    historyHasPages,
    loadOlder,
  } = useBotTimeline(
    selection.botConversations,
    selection.conversationId,
    selection.snapshot,
  );
  const messageTexts = messages.map((message) => message.text);
  const latestMessage = messages.at(-1);
  const latestRowId = latestMessage
    ? rowId(latestMessage.conversationId, latestMessage.id)
    : null;
  const previousScrollTop = useRef(0);
  const touchStartY = useRef<number | null>(null);
  const touchTriggeredHistory = useRef(false);
  const scrollConversationId = useRef(selection.conversationId);
  if (scrollConversationId.current !== selection.conversationId) {
    scrollConversationId.current = selection.conversationId;
    previousScrollTop.current = 0;
    touchStartY.current = null;
    touchTriggeredHistory.current = false;
  }
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
  const hasUsageTokens =
    (snapshot?.usage?.totalTokens ?? 0) > 0 ||
    (snapshot?.usage?.inputTokens ?? 0) > 0 ||
    (snapshot?.usage?.outputTokens ?? 0) > 0 ||
    (snapshot?.usage?.cacheReadTokens ?? 0) > 0 ||
    (snapshot?.usage?.cacheWriteTokens ?? 0) > 0;
  const pendingSubmission = messaging.pendingSubmission;
  const currentSubmissionPending = pendingSubmission?.conversationId === selection.conversationId;
  const pendingSubmissionInAnotherConversation =
    pendingSubmission !== null && !currentSubmissionPending;
  const composerDisabled =
    !hasConversation ||
    connection.composerBusy ||
    connection.runnerUnavailable ||
    !connection.ready;
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
        {hasConversation && snapshot && (
          <Popover>
            <PopoverTrigger
              aria-label="查看会话用量"
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-sm transition-colors outline-none focus-visible:ring-3"
            >
              <ActivityIcon className="size-4" />
              <span className="hidden sm:inline">用量</span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <PopoverHeader>
                <PopoverTitle>会话用量</PopoverTitle>
                <PopoverDescription>
                  Conversation 累计模型用量；不同订阅方式的实际账单可能不同。
                </PopoverDescription>
              </PopoverHeader>
              {snapshot.usage && hasUsageTokens ? (
                <dl className="bg-muted/50 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md p-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">输入</dt>
                    <dd className="font-medium tabular-nums">
                      {tokenFormatter.format(snapshot.usage.inputTokens)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">输出</dt>
                    <dd className="font-medium tabular-nums">
                      {tokenFormatter.format(snapshot.usage.outputTokens)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">缓存读取</dt>
                    <dd className="font-medium tabular-nums">
                      {tokenFormatter.format(snapshot.usage.cacheReadTokens)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">缓存写入</dt>
                    <dd className="font-medium tabular-nums">
                      {tokenFormatter.format(snapshot.usage.cacheWriteTokens)}
                    </dd>
                  </div>
                  <div className="col-span-2 border-t pt-2">
                    <dt className="text-muted-foreground text-xs">总 Token</dt>
                    <dd className="font-medium tabular-nums">
                      {tokenFormatter.format(snapshot.usage.totalTokens)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="bg-muted/50 text-muted-foreground rounded-md p-3 text-sm">
                  暂无可用的模型 Token 数据，可能是尚未产生响应或 Provider 未返回用量。
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-1 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">模型调用次数</dt>
                  <dd>暂不可用</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">累计模型计价（USD）</dt>
                  <dd className="font-medium tabular-nums">
                    {snapshot.usage?.costUsd === null || snapshot.usage?.costUsd === undefined
                      ? "暂无可信价格数据"
                      : usdFormatter.format(snapshot.usage.costUsd)}
                  </dd>
                </div>
              </dl>
              <p className="text-muted-foreground px-1 text-xs">
                调用次数尚未由运行时准确记录；价格未提供时不按 Token 推算费用。
              </p>
              <section aria-label="按模型聚合用量" className="space-y-2 border-t pt-3">
                <h3 className="text-muted-foreground text-xs font-medium">按模型聚合</h3>
                {(snapshot.usage?.models ?? []).length > 0 ? (
                  <ul className="space-y-2">
                    {(snapshot.usage?.models ?? []).map((model) => (
                      <li key={model.model} className="bg-muted/50 min-w-0 rounded-md p-2 text-sm">
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium" title={model.model}>
                            {model.model}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {model.costUsd === null
                              ? "暂无可信价格数据"
                              : usdFormatter.format(model.costUsd)}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                          总 Token {tokenFormatter.format(model.totalTokens)} · 输入{" "}
                          {tokenFormatter.format(model.inputTokens)} / 输出{" "}
                          {tokenFormatter.format(model.outputTokens)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">暂无按模型统计的数据。</p>
                )}
              </section>
            </PopoverContent>
          </Popover>
        )}
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
          className="hover:aria-expanded:bg-muted aria-expanded:bg-transparent"
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
      {pendingSubmissionInAnotherConversation && pendingSubmission && (
        <Alert className="animate-fade-in rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center justify-between gap-2 px-5 py-3">
            <span>另一会话有一条接纳结果待确认。请先返回原会话重试，再发送新消息。</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/bots/$botId",
                  params: { botId: pendingSubmission.botId },
                })
              }
            >
              返回待确认会话
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            className="px-5"
            preserveScrollOnPrepend
            onScroll={(event) => {
              const scrollTop = event.currentTarget.scrollTop;
              const reachedTop = scrollTop <= 48 && previousScrollTop.current > 48;
              previousScrollTop.current = scrollTop;
              if (reachedTop) loadOlder();
            }}
            onWheel={(event) => {
              if (event.deltaY < 0 && event.currentTarget.scrollTop <= 48) loadOlder();
            }}
            onTouchStart={(event) => {
              touchStartY.current = event.touches[0]?.clientY ?? null;
              touchTriggeredHistory.current = false;
            }}
            onTouchMove={(event) => {
              const startY = touchStartY.current;
              const currentY = event.touches[0]?.clientY;
              if (
                startY !== null &&
                currentY !== undefined &&
                currentY - startY > 12 &&
                event.currentTarget.scrollTop <= 48 &&
                !touchTriggeredHistory.current
              ) {
                touchTriggeredHistory.current = true;
                loadOlder();
              }
            }}
            onTouchEnd={() => {
              touchStartY.current = null;
              touchTriggeredHistory.current = false;
            }}
          >
            <MessageScrollerContent
              aria-busy={hasLiveTasks || snapshotLoading}
              className="mx-auto w-full max-w-3xl py-6"
            >
              {historyLoading && hasConversation && (
                <MessageScrollerItem messageId="history:loading">
                  <Marker role="status" aria-label="正在加载更早消息">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>
                      {historyHasPages ? "正在同步聊天记录…" : "正在加载聊天记录…"}
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {historyError && !historyLoading && (
                <MessageScrollerItem messageId="history:error">
                  <Marker role="status" aria-label="更早消息读取失败">
                    <MarkerContent>更早消息暂时无法读取；再次滚动到顶部重试。</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
              {messages.map((message) => (
                <MessageScrollerItem
                  key={rowId(message.conversationId, message.id)}
                  messageId={rowId(message.conversationId, message.id)}
                  scrollAnchor
                  className={
                    rowId(message.conversationId, message.id) === animatedRowId
                      ? message.role === "user"
                        ? "animate-message-in-end"
                        : "animate-message-in"
                      : undefined
                  }
                >
                  <MessageBody
                    message={message}
                    streaming={
                      rowId(message.conversationId, message.id) === latestRowId && hasLiveTasks
                    }
                    texts={messageTexts}
                  />
                </MessageScrollerItem>
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
                      <EmptyDescription>
                        {selection.openingConversation
                          ? "正在打开聊天…"
                          : selection.openConversationError
                            ? `打开聊天失败：${selection.openConversationError.message}`
                            : "准备好后，直接发送消息开始聊天。"}
                      </EmptyDescription>
                    </EmptyHeader>
                    {selection.openingConversation && <Spinner aria-label="正在打开聊天" />}
                    {selection.openConversationError && (
                      <EmptyContent>
                        <Button
                          disabled={
                            connection.busy ||
                            connection.runnerUnavailable ||
                            !connection.ready ||
                            selection.openingConversation
                          }
                          onClick={() => void selection.retryOpenConversation()}
                        >
                          重试打开聊天
                        </Button>
                      </EmptyContent>
                    )}
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
              {hasConversation && snapshot && messages.length === 0 && !historyLoading && (
                <MessageScrollerItem messageId="empty-conversation">
                  <Empty className="animate-fade-in min-h-40">
                    <EmptyHeader>
                      <EmptyTitle>开始这次对话</EmptyTitle>
                      <EmptyDescription>输入第一条消息，Bot 会接着往下做。</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </MessageScrollerItem>
              )}
              {currentSubmissionPending && (
                <MessageScrollerItem messageId="status:pending">
                  <Marker role="status" className="animate-fade-in">
                    {messaging.submitting && (
                      <MarkerIcon>
                        <Spinner />
                      </MarkerIcon>
                    )}
                    <MarkerContent>
                      {messaging.submitting
                        ? "正在发送消息…"
                        : "上一条消息的接纳结果待确认；重试会复用原消息，已修改的输入会在确认后保留。"}
                    </MarkerContent>
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
          {messaging.attachments.length > 0 && (
            <InputGroupAddon align="block-start" className="flex-wrap">
              {messaging.attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                >
                  {attachment.kind === "image" ? <ImageIcon /> : <FileTextIcon />}
                  <span className="max-w-52 truncate" title={attachment.name}>
                    {attachment.name}
                  </span>
                  <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>
                  <button
                    type="button"
                    aria-label={`移除附件 ${attachment.name}`}
                    disabled={currentSubmissionPending || messaging.submitting}
                    className="hover:text-foreground focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                    onClick={() => void messaging.removeAttachment(attachment)}
                  >
                    <XIcon aria-hidden="true" />
                  </button>
                </span>
              ))}
              <span className="text-muted-foreground basis-full text-xs">
                发送后，附件内容会保存在本机会话记录中用于恢复上下文；聊天记录只显示文件名和类型。
              </span>
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            aria-label="发送消息"
            className="max-h-40 min-h-16"
            disabled={composerDisabled}
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
              aria-label="添加附件"
              title={
                !connection.supportsAttachments
                  ? "当前 Runner 不支持附件"
                  : "添加文本或图片附件，最多 3 个"
              }
              disabled={
                composerDisabled ||
                pendingSubmissionInAnotherConversation ||
                !connection.supportsAttachments ||
                messaging.pickingAttachments ||
                messaging.pendingSubmission !== null ||
                messaging.attachments.length >= 3
              }
              onClick={() => void messaging.pickAttachments()}
            >
              {messaging.pickingAttachments ? <Spinner /> : <PaperclipIcon />}
              <span className="sr-only">添加附件</span>
            </InputGroupButton>
            <InputGroupButton
              aria-label={currentSubmissionPending ? "重试" : "发送"}
              size="icon-sm"
              variant="default"
              type="submit"
              className="ml-auto"
              disabled={
                composerDisabled ||
                pendingSubmissionInAnotherConversation ||
                (!currentSubmissionPending &&
                  !messaging.input.trim() &&
                  messaging.attachments.length === 0) ||
                messaging.submitting
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
