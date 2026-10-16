import {
  ArrowUpIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareIcon,
  UsersIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  runnerClient,
  type Bot,
  type BotDraft,
  type ConversationSnapshot,
  type ConversationSummary,
  type InitializeResult,
  type RunnerCapabilities,
} from "@/app/runner-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type PendingSubmission = { conversationId: number; text: string; requestId: string };
const defaultInstructions = "用简体中文回答，先给出直接结论。";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [botDialogOpen, setBotDialogOpen] = useState(false);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [capabilities, setCapabilities] = useState<RunnerCapabilities>({
    extensions: [],
    tools: [],
  });
  const [selectedBotId, setSelectedBotId] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [storedSnapshot, setStoredSnapshot] = useState<ConversationSnapshot | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState("");
  const [credentialWarning, setCredentialWarning] = useState("");
  const [runnerUnavailable, setRunnerUnavailable] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [editBotId, setEditBotId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [modelId, setModelId] = useState("deepseek-chat");
  const [thinkingLevel, setThinkingLevel] = useState<Bot["thinkingLevel"]>("medium");
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [cwd, setCwd] = useState("");
  const [extensions, setExtensions] = useState<string[]>(["coding-tools"]);
  const [tools, setTools] = useState<string[]>([]);
  const [conversationCwd, setConversationCwd] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [goalDraftState, setGoalDraftState] = useState<{
    conversationId: number | null;
    updatedAt: number | null;
    value: string;
  }>({ conversationId: null, updatedAt: null, value: "" });
  const [input, setInput] = useState("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [acceptedSubmission, setAcceptedSubmission] = useState<{
    conversationId: number;
    id: number;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    void runnerClient
      .initialize()
      .then((initial: InitializeResult) => {
        if (!mounted) return;
        setBots(initial.bots);
        setConversations(initial.conversations);
        setCapabilities(initial.capabilities);
        setExtensions(
          initial.capabilities.extensions.includes("coding-tools") ? ["coding-tools"] : [],
        );
        setTools(
          initial.capabilities.tools
            .filter((tool) => tool.extension === "coding-tools")
            .map((tool) => tool.name),
        );
        setProviderConfigured(initial.apiKeyConfigured);
        setRuntimeVersion(initial.runtimeVersion);
        setCredentialWarning(initial.credentialWarning ?? "");
        setRunnerUnavailable(false);
        setSelectedBotId(initial.bots.find((bot) => !bot.archived)?.id ?? "");
        setConversationId(initial.conversations[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (mounted) {
          setRunnerUnavailable(true);
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (conversationId === null) {
      return;
    }
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const value = await runnerClient.snapshot(conversationId);
        if (active) {
          setStoredSnapshot(value);
          setProviderConfigured(value.apiKeyConfigured);
          setRunnerUnavailable(false);
          setError("");
        }
      } catch (cause) {
        if (active) {
          setRunnerUnavailable(true);
          setError(errorMessage(cause));
        }
      } finally {
        if (active) timer = window.setTimeout(() => void refresh(), 1_200);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conversationId]);

  const snapshot = storedSnapshot?.conversation.id === conversationId ? storedSnapshot : null;
  const goalUpdatedAt = snapshot?.goal.updatedAt ?? null;
  const goalDescription = snapshot?.goal.description ?? "";
  const goalDraft =
    goalDraftState.conversationId === conversationId && goalDraftState.updatedAt === goalUpdatedAt
      ? goalDraftState.value
      : goalDescription;
  const currentAcceptedSubmissionId =
    acceptedSubmission?.conversationId === conversationId ? acceptedSubmission.id : null;
  const acceptedSubmissionStatus = snapshot?.submissions.find(
    (submission) => submission.id === currentAcceptedSubmissionId,
  );

  const selectedBot = bots.find((bot) => bot.id === selectedBotId && !bot.archived);
  const linkedBot = bots.find((bot) => bot.id === snapshot?.conversation.botId);
  const activeBot = snapshot ? linkedBot : selectedBot;
  const lastMessageId = snapshot?.messages.at(-1)?.id;
  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [conversationId, lastMessageId]);

  const hasLiveTasks = (snapshot?.activeTasks.length ?? 0) > 0;
  const executing = snapshot?.activeTasks.some((task) => task.status === "running") ?? false;
  const executionStatus = executing ? "执行中" : hasLiveTasks ? "等待中" : "空闲";
  const hasUpdatedBotSettings = Boolean(
    snapshot && linkedBot && linkedBot.revision !== snapshot.conversation.botRevision,
  );
  const selectedTools = new Set(tools);
  const selectedExtensions = new Set(extensions);

  function beginNewBot() {
    setEditBotId(null);
    setName("");
    setModelId("deepseek-chat");
    setThinkingLevel("medium");
    setInstructions(defaultInstructions);
    setCwd("");
    setExtensions(capabilities.extensions.includes("coding-tools") ? ["coding-tools"] : []);
    setTools(
      capabilities.tools
        .filter((tool) => tool.extension === "coding-tools")
        .map((tool) => tool.name),
    );
  }

  function beginEditBot(bot: Bot) {
    setEditBotId(bot.id);
    setSelectedBotId(bot.id);
    setName(bot.name);
    setModelId(bot.model.provider === "deepseek" ? bot.model.modelId : "deepseek-chat");
    setThinkingLevel(bot.thinkingLevel);
    setInstructions(bot.instructions);
    setCwd(bot.cwd);
    setExtensions([...bot.extensions]);
    setTools([...bot.tools]);
  }

  function toggleExtension(extensionName: string, checked: boolean) {
    setExtensions((previous) =>
      checked
        ? [...new Set([...previous, extensionName])]
        : previous.filter((item) => item !== extensionName),
    );
    if (!checked) {
      const removedTools = new Set(
        capabilities.tools
          .filter((tool) => tool.extension === extensionName)
          .map((tool) => tool.name),
      );
      setTools((current) => current.filter((tool) => !removedTools.has(tool)));
    }
  }

  async function onSaveBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const draft: BotDraft = { name, modelId, thinkingLevel, instructions, cwd, extensions, tools };
    try {
      if (editBotId) {
        const result = await runnerClient.updateBot(editBotId, draft);
        setBots(result.bots);
        setSelectedBotId(result.bot.id);
        setNotice(`已保存 ${result.bot.name} 的新配置。现有 Conversation 不会自动改变。`);
      } else {
        const bot = await runnerClient.createBot(draft);
        setBots((previous) => [...previous, bot]);
        setSelectedBotId(bot.id);
        setConversationId(null);
        setBotDialogOpen(false);
        setNotice(`已创建 ${bot.name}。`);
        try {
          const conversation = await runnerClient.createConversation(bot.id, "", "");
          setConversations((previous) => [conversation, ...previous]);
          setConversationId(conversation.id);
          setSearch("");
        } catch (cause) {
          setError(
            `智能体已创建，但打开聊天失败：${errorMessage(cause)}。可以点击“开始聊天”重试。`,
          );
        }
      }
      setBotDialogOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startChat() {
    if (selectedBot) {
      await onCreateConversation();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const bot = await runnerClient.createBot({
        name: "幕僚长",
        modelId: "deepseek-chat",
        thinkingLevel: "medium",
        instructions: defaultInstructions,
        cwd: "",
        extensions: [],
        tools: [],
      });
      setBots((previous) => [...previous, bot]);
      setSelectedBotId(bot.id);
      const created = await runnerClient.createConversation(bot.id, conversationCwd, newGoal);
      setConversations((previous) => [created, ...previous]);
      setConversationId(created.id);
      setChatDialogOpen(false);
      setConversationCwd("");
      setNewGoal("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateConversation() {
    if (!selectedBot) return;
    setBusy(true);
    setError("");
    try {
      const created = await runnerClient.createConversation(
        selectedBot.id,
        conversationCwd,
        newGoal,
      );
      setConversations((previous) => [created, ...previous]);
      setConversationCwd("");
      setNewGoal("");
      setConversationId(created.id);
      setChatDialogOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onArchiveBot(bot: Bot) {
    setBusy(true);
    setError("");
    try {
      const result = await runnerClient.archiveBot(bot.id);
      setBots(result.bots);
      if (selectedBotId === bot.id)
        setSelectedBotId(result.bots.find((item) => !item.archived)?.id ?? "");
      if (editBotId === bot.id) beginNewBot();
      setBotDialogOpen(false);
      setNotice(`${bot.name} 已归档；已有聊天保留关联。`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onApplyBotSettings() {
    if (conversationId === null) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await runnerClient.applyBotSettings(conversationId);
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, botRevision: result.botRevision }
            : conversation,
        ),
      );
      setStoredSnapshot(await runnerClient.snapshot(conversationId));
      setNotice("Bot 设置已应用到此 Conversation。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conversationId === null) return;
    setBusy(true);
    setError("");
    try {
      await runnerClient.saveGoal(conversationId, goalDraft);
      setStoredSnapshot(await runnerClient.snapshot(conversationId));
      setNotice("工作目标已保存。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onSetGoalStatus(status: "open" | "completed") {
    if (conversationId === null) return;
    setBusy(true);
    setError("");
    try {
      await runnerClient.setGoalStatus(conversationId, status);
      setStoredSnapshot(await runnerClient.snapshot(conversationId));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onRestartRunner() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await runnerClient.restartRunner();
      const initial = await runnerClient.initialize();
      setBots(initial.bots);
      setConversations(initial.conversations);
      setCapabilities(initial.capabilities);
      setProviderConfigured(initial.apiKeyConfigured);
      setRuntimeVersion(initial.runtimeVersion);
      setCredentialWarning(initial.credentialWarning ?? "");
      setRunnerUnavailable(false);
      setSelectedBotId((previous) =>
        initial.bots.some((bot) => bot.id === previous && !bot.archived)
          ? previous
          : (initial.bots.find((bot) => !bot.archived)?.id ?? ""),
      );
      if (!initial.conversations.some((conversation) => conversation.id === conversationId)) {
        setConversationId(initial.conversations[0]?.id ?? null);
      }
      setNotice("Runner 已重新启动，pi-durable 正在恢复未完成工作。");
    } catch (cause) {
      setRunnerUnavailable(true);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onSetProviderCredential(apiKey: string | null) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await runnerClient.setProviderCredential(apiKey);
      setProviderConfigured(result.configured);
      setProviderKey("");
      setCredentialWarning("");
      setNotice(
        apiKey === null
          ? result.configured
            ? "系统凭据库中的密钥已移除；当前使用 DEEPSEEK_API_KEY 环境变量。"
            : "已从系统凭据库移除 Provider 密钥。"
          : result.runnerUpdated
            ? "Provider 密钥已安全保存并交给 Runner。"
            : "Provider 密钥已保存；Runner 将在下次启动时读取。",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (conversationId === null || !text) return;
    if (
      pendingSubmission &&
      (pendingSubmission.conversationId !== conversationId || pendingSubmission.text !== text)
    ) {
      setError("上一条提交结果尚未确认。返回原 Conversation 重试，确认前不要更改输入。");
      return;
    }
    const attempt = pendingSubmission ?? {
      conversationId,
      text,
      requestId: crypto.randomUUID(),
    };
    setPendingSubmission(attempt);
    setBusy(true);
    setError("");
    try {
      const accepted = await runnerClient.submit(
        attempt.conversationId,
        attempt.text,
        attempt.requestId,
      );
      setAcceptedSubmission({ conversationId, id: accepted.id });
      setPendingSubmission(null);
      setInput("");
      try {
        setStoredSnapshot(await runnerClient.snapshot(conversationId));
      } catch (cause) {
        setError(`输入已被 Runner 接纳，但刷新展示失败：${errorMessage(cause)}`);
      }
    } catch (cause) {
      setError(`${errorMessage(cause)}。接纳结果尚未确认，重试会复用同一 requestId。`);
    } finally {
      setBusy(false);
    }
  }

  async function onAbort() {
    if (conversationId === null) return;
    setBusy(true);
    setError("");
    try {
      await runnerClient.abort(conversationId);
      setStoredSnapshot(await runnerClient.snapshot(conversationId));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onWithdrawSubmission(submissionId: number) {
    if (conversationId === null) return;
    setBusy(true);
    setError("");
    try {
      const result = await runnerClient.abortSubmission(conversationId, submissionId);
      setStoredSnapshot(await runnerClient.snapshot(conversationId));
      setNotice(
        result.status === "aborted"
          ? "排队输入已撤回。"
          : result.status === "already_placed"
            ? "输入已进入执行记录，无法再按排队输入撤回。"
            : "该输入已结束或当前不存在。",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="text-muted-foreground grid h-full place-items-center text-sm">
        正在打开 Runner…
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground flex h-full min-h-0 overflow-hidden">
      {sidebarOpen && (
        <aside
          aria-label="会话列表"
          className="bg-sidebar flex w-64 shrink-0 flex-col border-r xl:w-72"
        >
          <header className="flex h-16 shrink-0 items-center justify-between px-4">
            <span className="font-semibold" data-tauri-drag-region>
              AgentChat
            </span>
            <div className="flex gap-1">
              <Button
                aria-label="收起会话列表"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSidebarOpen(false)}
              >
                <PanelLeftIcon />
              </Button>
              <Button
                aria-label="新建聊天"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                onClick={() => setChatDialogOpen(true)}
              >
                <PlusIcon />
              </Button>
            </div>
          </header>
          <div className="px-3 pb-3">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="搜索会话"
                placeholder="搜索"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
          </div>
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2" aria-label="聊天">
            {conversations
              .filter((item) => item.botName.toLowerCase().includes(search.toLowerCase()))
              .map((conversation) => (
                <Button
                  key={conversation.id}
                  variant={conversationId === conversation.id ? "secondary" : "ghost"}
                  className="h-auto w-full justify-start gap-3 py-3"
                  onClick={() => {
                    setConversationId(conversation.id);
                    setSelectedBotId(conversation.botId);
                  }}
                >
                  <Avatar size="lg">
                    <AvatarFallback>
                      <SparklesIcon className="size-5" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{conversation.botName}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatDate(conversation.createdAt)}
                      </span>
                    </span>
                    <span className="text-muted-foreground mt-1 block truncate text-xs">
                      {conversationId === conversation.id
                        ? (snapshot?.messages.at(-1)?.text ?? "开始新的对话")
                        : "点击继续聊天"}
                    </span>
                  </span>
                </Button>
              ))}
            {conversations.length === 0 && (
              <p className="text-muted-foreground px-3 py-6 text-sm">还没有聊天，点击 + 开始。</p>
            )}
            {conversations.length > 0 &&
              !conversations.some((item) =>
                item.botName.toLowerCase().includes(search.toLowerCase()),
              ) && <p className="text-muted-foreground px-3 py-6 text-sm">没有找到匹配的会话。</p>}
          </nav>
          <footer className="flex items-center justify-between border-t p-3">
            <Button
              aria-label="设置"
              title="设置"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                beginNewBot();
                setBotDialogOpen(true);
              }}
            >
              <UsersIcon />
              智能体
            </Button>
          </footer>
        </aside>
      )}

      <section aria-label="聊天内容" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
          {!sidebarOpen && (
            <Button
              aria-label="展开会话列表"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftIcon />
            </Button>
          )}
          <div className="min-w-0 flex-1" data-tauri-drag-region>
            <h1 className="truncate text-sm font-semibold">
              {snapshot?.conversation.botName ?? "AgentChat"}
            </h1>
            <p className="text-muted-foreground truncate text-xs">
              DeepSeek · 本机{snapshot ? ` · ${executionStatus}` : ""}
            </p>
          </div>
          {hasLiveTasks && (
            <Button disabled={busy} size="sm" variant="outline" onClick={() => void onAbort()}>
              <SquareIcon />
              停止
            </Button>
          )}
          <Button
            aria-label={inspectorOpen ? "收起智能体资料" : "展开智能体资料"}
            aria-expanded={inspectorOpen}
            variant="ghost"
            size="icon-sm"
            onClick={() => setInspectorOpen((value) => !value)}
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
                onClick={() => void onRestartRunner()}
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
              onClick={() => setNotice("")}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {snapshot && !providerConfigured && (
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-5 py-2 text-xs">
            <span>尚未检测到 DeepSeek 凭据。</span>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
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
              <p className="text-muted-foreground text-center text-xs">
                {formatDate(
                  conversations.find((item) => item.id === conversationId)?.createdAt ?? 0,
                )}
              </p>
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
                  <p className="text-muted-foreground mt-2 text-sm">
                    使用 DeepSeek，开始一次对话。
                  </p>
                </div>
                {!snapshot && (
                  <Button disabled={busy || runnerUnavailable} onClick={() => void startChat()}>
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
                <div
                  key={submission.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-muted-foreground">消息 #{submission.id} 等待处理</span>
                  {submission.type === "input" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onWithdrawSubmission(submission.id)}
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
        <form className="px-5 pt-2 pb-4" onSubmit={(event) => void onSubmit(event)}>
          <InputGroup className="mx-auto max-w-3xl">
            <InputGroupTextarea
              aria-label="发送消息"
              className="max-h-40 min-h-16"
              disabled={!snapshot || busy || pendingSubmission !== null}
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
                onClick={() => setInspectorOpen(true)}
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
                  !input.trim() ||
                  (pendingSubmission !== null &&
                    pendingSubmission.conversationId !== conversationId)
                }
              >
                <ArrowUpIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </section>

      {inspectorOpen && (
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
              onClick={() => setInspectorOpen(false)}
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
                    <p className="text-muted-foreground text-xs">DeepSeek · 本机</p>
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
                      beginEditBot(activeBot);
                      setBotDialogOpen(true);
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
                  <InfoRow label="服务商" value="DeepSeek" />
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
                      <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
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
                      disabled={busy || hasLiveTasks}
                      onClick={() => void onApplyBotSettings()}
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
                    <form className="space-y-3" onSubmit={(event) => void onSaveGoal(event)}>
                      <Textarea
                        aria-label="工作目标"
                        placeholder="记录这次聊天要完成的工作"
                        value={goalDraft}
                        onChange={(event) =>
                          setGoalDraftState({
                            conversationId,
                            updatedAt: goalUpdatedAt,
                            value: event.target.value,
                          })
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          type="submit"
                          disabled={busy || goalDraft === snapshot.goal.description}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !snapshot.goal.description.trim()}
                          onClick={() =>
                            void onSetGoalStatus(
                              snapshot.goal.status === "open" ? "completed" : "open",
                            )
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
                      beginEditBot(activeBot);
                      setBotDialogOpen(true);
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
      )}

      <Dialog open={botDialogOpen} onOpenChange={setBotDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editBotId ? "编辑智能体" : "新建智能体"}</DialogTitle>
            <DialogDescription>设置名称、描述、模型和可用工具。</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(event) => void onSaveBot(event)}>
            <Input
              aria-label="Bot 名称"
              onChange={(event) => setName(event.target.value)}
              placeholder="名称"
              required
              value={name}
            />
            <label className="block space-y-2 text-sm">
              模型
              <select
                aria-label="模型 ID"
                className="bg-background h-9 w-full rounded-md border px-2"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner · 深度思考</option>
              </select>
            </label>
            <label className="text-muted-foreground block text-xs">
              Thinking Level
              <select
                aria-label="Thinking Level"
                className="bg-background text-foreground mt-1 h-9 w-full rounded-md border px-2 text-sm"
                onChange={(event) => setThinkingLevel(event.target.value as Bot["thinkingLevel"])}
                value={thinkingLevel}
              >
                {["minimal", "low", "medium", "high", "xhigh"].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <Textarea
              aria-label="指令"
              className="min-h-20 resize-y"
              onChange={(event) => setInstructions(event.target.value)}
              value={instructions}
            />
            <Input
              aria-label="默认工作目录"
              onChange={(event) => setCwd(event.target.value)}
              placeholder="默认工作目录（可留空）"
              value={cwd}
            />
            <fieldset className="space-y-1 rounded-md border p-2">
              <legend className="px-1 text-xs font-medium">Extensions</legend>
              {capabilities.extensions.map((extension) => (
                <label className="flex items-center gap-2 text-xs" key={extension}>
                  <input
                    checked={selectedExtensions.has(extension)}
                    onChange={(event) => toggleExtension(extension, event.target.checked)}
                    type="checkbox"
                  />
                  {extension}
                </label>
              ))}
              {capabilities.extensions.length === 0 && (
                <p className="text-muted-foreground text-xs">Runner 当前没有可用 Extension。</p>
              )}
            </fieldset>
            <fieldset className="space-y-1 rounded-md border p-2">
              <legend className="px-1 text-xs font-medium">Tools</legend>
              {capabilities.tools.map((tool) => (
                <label
                  className="flex items-center gap-2 text-xs"
                  key={`${tool.extension}:${tool.name}`}
                >
                  <input
                    checked={selectedTools.has(tool.name)}
                    disabled={!selectedExtensions.has(tool.extension)}
                    onChange={(event) =>
                      setTools((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, tool.name])]
                          : previous.filter((item) => item !== tool.name),
                      )
                    }
                    type="checkbox"
                  />
                  {tool.name} <span className="text-muted-foreground">({tool.extension})</span>
                </label>
              ))}
              {capabilities.tools.length === 0 && (
                <p className="text-muted-foreground text-xs">Runner 当前没有可用 Tool。</p>
              )}
            </fieldset>
            <p className="text-muted-foreground text-xs leading-5">
              工作目录只是默认位置，不是文件访问隔离。配置变化只影响新建
              Conversation；已有对话需单独应用。
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy || !name.trim() || !modelId.trim()}
                type="submit"
              >
                {editBotId ? "保存智能体" : "创建智能体"}
              </Button>
              {editBotId && (
                <Button
                  disabled={busy}
                  onClick={() => setBotDialogOpen(false)}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
              )}
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </form>
          {editBotId && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const bot = bots.find((item) => item.id === editBotId);
                if (bot) void onArchiveBot(bot);
              }}
            >
              归档智能体
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={chatDialogOpen} onOpenChange={setChatDialogOpen}>
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
                  onClick={() => setSelectedBotId(bot.id)}
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
              setChatDialogOpen(false);
              beginNewBot();
              setBotDialogOpen(true);
            }}
          >
            新建智能体
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setProviderKey("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>DeepSeek 凭据与本机运行状态。</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {providerConfigured ? "DeepSeek 密钥已配置" : "未检测到 DEEPSEEK_API_KEY"}
          </p>
          <Input
            aria-label="DeepSeek API Key"
            type="password"
            autoComplete="off"
            placeholder="输入新的 DeepSeek API Key"
            value={providerKey}
            onChange={(event) => setProviderKey(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={busy || !providerKey.trim()}
              onClick={() => void onSetProviderCredential(providerKey.trim())}
            >
              安全保存
            </Button>
            <Button
              variant="outline"
              disabled={busy || !providerConfigured}
              onClick={() => void onSetProviderCredential(null)}
            >
              移除已保存密钥
            </Button>
          </div>
          <p className="text-muted-foreground text-xs leading-5">
            密钥保存在系统凭据库。未保存时从宿主环境变量 DEEPSEEK_API_KEY 读取。
          </p>
          <Separator />
          <InfoRow label="本机状态" value={runnerUnavailable ? "连接失败" : "已连接"} />
          <Button variant="outline" disabled={busy} onClick={() => void onRestartRunner()}>
            重新连接
          </Button>
          <p className="text-muted-foreground text-xs">Node {runtimeVersion || "—"}</p>
          {(error || credentialWarning) && (
            <p role="alert" className="text-destructive text-sm">
              {error || credentialWarning}
            </p>
          )}
          {notice && (
            <p role="status" className="text-muted-foreground text-sm">
              {notice}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function InspectorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex min-h-7 items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words">{value}</span>
    </div>
  );
}

function formatDate(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
