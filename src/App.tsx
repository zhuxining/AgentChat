import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  runnerClient,
  type Bot,
  type BotDraft,
  type ConversationSnapshot,
  type ConversationSummary,
  type InitializeResult,
  type RunnerCapabilities,
} from "@/app/runner-client";

type PendingSubmission = { conversationId: number; text: string; requestId: string };
const defaultInstructions = "用简体中文回答，先给出直接结论。";

export default function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [capabilities, setCapabilities] = useState<RunnerCapabilities>({ extensions: [], tools: [] });
  const [selectedBotId, setSelectedBotId] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
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
  const [modelId, setModelId] = useState("gpt-5-mini");
  const [thinkingLevel, setThinkingLevel] = useState<Bot["thinkingLevel"]>("medium");
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [cwd, setCwd] = useState("");
  const [extensions, setExtensions] = useState<string[]>(["coding-tools"]);
  const [tools, setTools] = useState<string[]>([]);
  const [conversationCwd, setConversationCwd] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [input, setInput] = useState("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [acceptedSubmissionId, setAcceptedSubmissionId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    void runnerClient
      .initialize()
      .then((initial: InitializeResult) => {
        if (!mounted) return;
        setBots(initial.bots);
        setConversations(initial.conversations);
        setCapabilities(initial.capabilities);
        setExtensions(initial.capabilities.extensions.includes("coding-tools") ? ["coding-tools"] : []);
        setTools(initial.capabilities.tools.filter((tool) => tool.extension === "coding-tools").map((tool) => tool.name));
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
    setAcceptedSubmissionId(null);
    if (conversationId === null) {
      setSnapshot(null);
      setGoalDraft("");
      return;
    }
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const value = await runnerClient.snapshot(conversationId);
        if (active) {
          setSnapshot(value);
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

  const goalUpdatedAt = snapshot?.goal.updatedAt;
  const goalDescription = snapshot?.goal.description;
  useEffect(() => {
    setGoalDraft(goalDescription ?? "");
  }, [conversationId, goalUpdatedAt, goalDescription]);

  const selectedBot = bots.find((bot) => bot.id === selectedBotId && !bot.archived);
  const linkedBot = bots.find((bot) => bot.id === snapshot?.conversation.botId);
  const hasLiveTasks = (snapshot?.activeTasks.length ?? 0) > 0;
  const executing = snapshot?.activeTasks.some((task) => task.status === "running") ?? false;
  const executionStatus = executing ? "执行中" : hasLiveTasks ? "等待中" : "空闲";
  const hasUpdatedBotSettings = Boolean(
    snapshot && linkedBot && linkedBot.revision !== snapshot.conversation.botRevision,
  );
  const selectedTools = new Set(tools);
  const selectedExtensions = new Set(extensions);
  const acceptedSubmission = snapshot?.submissions.find((submission) => submission.id === acceptedSubmissionId);

  function beginNewBot() {
    setEditBotId(null);
    setName("");
    setModelId("gpt-5-mini");
    setThinkingLevel("medium");
    setInstructions(defaultInstructions);
    setCwd("");
    setExtensions(capabilities.extensions.includes("coding-tools") ? ["coding-tools"] : []);
    setTools(capabilities.tools.filter((tool) => tool.extension === "coding-tools").map((tool) => tool.name));
  }

  function beginEditBot(bot: Bot) {
    setEditBotId(bot.id);
    setSelectedBotId(bot.id);
    setName(bot.name);
    setModelId(bot.model.modelId);
    setThinkingLevel(bot.thinkingLevel);
    setInstructions(bot.instructions);
    setCwd(bot.cwd);
    setExtensions([...bot.extensions]);
    setTools([...bot.tools]);
  }

  function toggleExtension(extensionName: string, checked: boolean) {
    setExtensions((previous) =>
      checked ? [...new Set([...previous, extensionName])] : previous.filter((item) => item !== extensionName),
    );
    if (!checked) {
      const removedTools = new Set(
        capabilities.tools.filter((tool) => tool.extension === extensionName).map((tool) => tool.name),
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
        setNotice(`已创建 ${bot.name}。`);
      }
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
      const created = await runnerClient.createConversation(selectedBot.id, conversationCwd, newGoal);
      setConversations((previous) => [created, ...previous]);
      setConversationCwd("");
      setNewGoal("");
      setConversationId(created.id);
      setNotice("Conversation 已创建，并保存了 Bot 配置快照。");
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
      if (selectedBotId === bot.id) setSelectedBotId(result.bots.find((item) => !item.archived)?.id ?? "");
      if (editBotId === bot.id) beginNewBot();
      setNotice(`${bot.name} 已归档；已有 Conversation 保留关联。`);
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
          conversation.id === conversationId ? { ...conversation, botRevision: result.botRevision } : conversation,
        ),
      );
      setSnapshot(await runnerClient.snapshot(conversationId));
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
      setSnapshot(await runnerClient.snapshot(conversationId));
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
      setSnapshot(await runnerClient.snapshot(conversationId));
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
          : initial.bots.find((bot) => !bot.archived)?.id ?? "",
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
            ? "系统凭据库中的密钥已移除；Runner 仍使用 OPENAI_API_KEY 环境变量。"
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
      const accepted = await runnerClient.submit(attempt.conversationId, attempt.text, attempt.requestId);
      setAcceptedSubmissionId(accepted.id);
      setPendingSubmission(null);
      setInput("");
      try {
        setSnapshot(await runnerClient.snapshot(conversationId));
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
      setSnapshot(await runnerClient.snapshot(conversationId));
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
      setSnapshot(await runnerClient.snapshot(conversationId));
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
    return <main className="grid h-full place-items-center text-sm text-muted-foreground">正在打开 Runner…</main>;
  }

  return (
    <main className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] bg-workspace text-foreground">
      <aside className="flex min-h-0 flex-col border-r bg-surface">
        <header className="border-b px-5 py-4">
          <h1 className="text-lg font-semibold">AgentChat</h1>
          <p className="mt-1 text-xs text-muted-foreground">本地 pi-durable Runner{runtimeVersion ? ` · Node ${runtimeVersion}` : ""}</p>
        </header>

        <section className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bots</h2>
              <Button onClick={beginNewBot} size="sm" variant="outline">新建</Button>
            </div>
            <div className="space-y-1">
              {bots.map((bot) => (
                <div key={bot.id} className="flex items-center gap-1">
                  <button
                    className={`min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-ring ${selectedBotId === bot.id ? "bg-elevated" : ""}`}
                    onClick={() => setSelectedBotId(bot.id)}
                    type="button"
                  >
                    <span className="block truncate">{bot.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {bot.model.modelId} · r{bot.revision}{bot.archived ? " · 已归档" : ""}
                    </span>
                  </button>
                  {!bot.archived && <Button aria-label={`编辑 ${bot.name}`} disabled={busy} onClick={() => beginEditBot(bot)} size="sm" variant="ghost">编辑</Button>}
                  {!bot.archived && <Button aria-label={`归档 ${bot.name}`} disabled={busy} onClick={() => void onArchiveBot(bot)} size="sm" variant="ghost">归档</Button>}
                </div>
              ))}
              {bots.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">创建一个 Bot 开始使用。</p>}
            </div>
          </div>

          <form className="space-y-2 border-t pt-4" onSubmit={(event) => void onSaveBot(event)}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{editBotId ? "编辑 Bot" : "新建 Bot"}</h2>
            <Input aria-label="Bot 名称" onChange={(event) => setName(event.target.value)} placeholder="名称" required value={name} />
            <Input aria-label="模型 ID" onChange={(event) => setModelId(event.target.value)} required value={modelId} />
            <label className="block text-xs text-muted-foreground">
              Thinking Level
              <select aria-label="Thinking Level" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" onChange={(event) => setThinkingLevel(event.target.value as Bot["thinkingLevel"])} value={thinkingLevel}>
                {["minimal", "low", "medium", "high", "xhigh"].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <Textarea aria-label="指令" className="min-h-20 resize-y" onChange={(event) => setInstructions(event.target.value)} value={instructions} />
            <Input aria-label="默认工作目录" onChange={(event) => setCwd(event.target.value)} placeholder="默认工作目录（可留空）" value={cwd} />
            <fieldset className="space-y-1 rounded-md border p-2">
              <legend className="px-1 text-xs font-medium">Extensions</legend>
              {capabilities.extensions.map((extension) => (
                <label className="flex items-center gap-2 text-xs" key={extension}>
                  <input checked={selectedExtensions.has(extension)} onChange={(event) => toggleExtension(extension, event.target.checked)} type="checkbox" />
                  {extension}
                </label>
              ))}
              {capabilities.extensions.length === 0 && <p className="text-xs text-muted-foreground">Runner 当前没有可用 Extension。</p>}
            </fieldset>
            <fieldset className="space-y-1 rounded-md border p-2">
              <legend className="px-1 text-xs font-medium">Tools</legend>
              {capabilities.tools.map((tool) => (
                <label className="flex items-center gap-2 text-xs" key={`${tool.extension}:${tool.name}`}>
                  <input
                    checked={selectedTools.has(tool.name)}
                    disabled={!selectedExtensions.has(tool.extension)}
                    onChange={(event) => setTools((previous) => event.target.checked ? [...new Set([...previous, tool.name])] : previous.filter((item) => item !== tool.name))}
                    type="checkbox"
                  />
                  {tool.name} <span className="text-muted-foreground">({tool.extension})</span>
                </label>
              ))}
              {capabilities.tools.length === 0 && <p className="text-xs text-muted-foreground">Runner 当前没有可用 Tool。</p>}
            </fieldset>
            <p className="text-xs leading-5 text-muted-foreground">工作目录只是默认位置，不是文件访问隔离。配置变化只影响新建 Conversation；已有对话需单独应用。</p>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy || !name.trim() || !modelId.trim()} type="submit">{editBotId ? "保存 Bot" : "创建 Bot"}</Button>
              {editBotId && <Button disabled={busy} onClick={beginNewBot} type="button" variant="outline">取消</Button>}
            </div>
          </form>

          <section className="space-y-2 border-t pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider 凭据</h2>
            <Input
              aria-label="OpenAI API Key"
              autoComplete="off"
              onChange={(event) => setProviderKey(event.target.value)}
              placeholder={providerConfigured ? "密钥已配置；输入新密钥以替换" : "OpenAI API Key"}
              type="password"
              value={providerKey}
            />
            <div className="flex gap-2">
              <Button disabled={busy || !providerKey.trim()} onClick={() => void onSetProviderCredential(providerKey.trim())} size="sm">安全保存</Button>
              <Button disabled={busy || !providerConfigured} onClick={() => void onSetProviderCredential(null)} size="sm" variant="outline">移除密钥</Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">密钥保存在系统凭据库，由 Runner 使用，不会写入 Bot、对话或展示数据。{providerConfigured ? "当前 Runner 已检测到凭据。" : "尚未检测到凭据。"}</p>
          </section>

          <section className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversations</h2>
              <Button disabled={!selectedBot || busy} onClick={() => void onCreateConversation()} size="sm" variant="outline">新建</Button>
            </div>
            <Input aria-label="Conversation 工作目录覆盖" onChange={(event) => setConversationCwd(event.target.value)} placeholder="本次工作目录覆盖（可留空）" value={conversationCwd} />
            <Textarea aria-label="新 Conversation 工作目标" className="min-h-16 resize-y" onChange={(event) => setNewGoal(event.target.value)} placeholder="新 Conversation 的工作目标（可留空）" value={newGoal} />
            <div className="space-y-1">
              {conversations.map((conversation) => (
                <button
                  className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-ring ${conversationId === conversation.id ? "bg-elevated" : ""}`}
                  key={conversation.id}
                  onClick={() => setConversationId(conversation.id)}
                  type="button"
                >
                  {conversation.botName} · #{conversation.id}
                </button>
              ))}
            </div>
          </section>
        </section>
      </aside>

      <section className="flex min-h-0 flex-col">
        <header className="flex min-h-14 items-center justify-between gap-4 border-b px-6 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{snapshot?.conversation.botName ?? "选择或新建 Conversation"}</h2>
            {snapshot && (
              <p className="truncate text-xs text-muted-foreground" title={snapshot.conversation.agent.cwd}>
                Conversation #{snapshot.conversation.id} · {snapshot.conversation.agent.model?.modelId ?? "无模型"} · {snapshot.conversation.agent.thinkingLevel} · 工作目录 {snapshot.conversation.agent.cwd} · {executionStatus}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {hasUpdatedBotSettings && <Button disabled={busy || hasLiveTasks} onClick={() => void onApplyBotSettings()} variant="outline">应用 Bot 更新</Button>}
            {hasLiveTasks && <Button disabled={busy} onClick={() => void onAbort()} variant="outline">停止执行</Button>}
          </div>
        </header>

        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/5 px-6 py-2 text-sm text-danger" role="alert">
            <span>{error}</span>
            {runnerUnavailable && <Button disabled={busy} onClick={() => void onRestartRunner()} size="sm" variant="outline">重启 Runner</Button>}
          </div>
        )}
        {notice && <div className="border-b bg-surface px-6 py-2 text-sm text-muted-foreground" role="status">{notice}</div>}
        {credentialWarning && <div className="border-b bg-danger/5 px-6 py-2 text-xs text-danger" role="alert">{credentialWarning}。可检查系统凭据服务后重启 Runner。</div>}
        {snapshot && snapshot.configurationErrors.missingExtensions.length + snapshot.configurationErrors.missingTools.length > 0 && (
          <div className="border-b border-danger/30 bg-danger/5 px-6 py-2 text-sm text-danger" role="alert">
            Conversation 配置引用了未加载的能力：{[...snapshot.configurationErrors.missingExtensions, ...snapshot.configurationErrors.missingTools].join(", ")}。编辑 Bot 并应用可用配置后才能继续提交。
          </div>
        )}
        {snapshot && !snapshot.apiKeyConfigured && (
          <div className="border-b px-6 py-2 text-xs text-muted-foreground">Runner 未检测到 OpenAI 凭据。请在左侧 Provider 凭据中设置。</div>
        )}

        {snapshot && (
          <section className="border-b bg-surface/60 px-6 py-3">
            <form className="mx-auto flex max-w-5xl items-start gap-2" onSubmit={(event) => void onSaveGoal(event)}>
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="work-goal">工作目标 · {snapshot.goal.status === "completed" ? "用户已确认完成" : "进行中"}</label>
                <Textarea id="work-goal" className="min-h-12 resize-y" onChange={(event) => setGoalDraft(event.target.value)} placeholder="记录这个 Conversation 要完成的工作" value={goalDraft} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={busy || goalDraft === snapshot.goal.description} size="sm" type="submit">保存目标</Button>
                {snapshot.goal.status === "open"
                  ? <Button disabled={busy || !snapshot.goal.description.trim()} onClick={() => void onSetGoalStatus("completed")} size="sm" type="button" variant="outline">确认完成</Button>
                  : <Button disabled={busy} onClick={() => void onSetGoalStatus("open")} size="sm" type="button" variant="outline">重新打开</Button>}
              </div>
            </form>
          </section>
        )}

        <div aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6">
          {snapshot?.hasMoreMessages && <p className="text-center text-xs text-muted-foreground">当前仅展示最近 50 条记录，历史分页尚未接入。</p>}
          {snapshot?.messages.filter((message) => message.text).map((message) => (
            <article className={`max-w-3xl whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-elevated" : "bg-card shadow-sm"}`} key={message.id}>
              <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">{message.role === "user" ? "你" : message.role === "assistant" ? "Agent" : "工具"}</p>
              {message.text}
              {message.truncated && <span className="ml-2 text-xs text-muted-foreground">（此条内容已截断）</span>}
            </article>
          ))}
          {pendingSubmission && pendingSubmission.conversationId === conversationId && (
            <p className="mx-auto max-w-3xl text-xs text-muted-foreground">正在等待 Runner 确认接纳。发生超时后重试会复用同一 requestId。</p>
          )}
          {acceptedSubmissionId !== null && (
            <p className="mx-auto max-w-3xl text-xs text-muted-foreground">
              Runner 已接纳输入 #{acceptedSubmissionId}{acceptedSubmission ? ` · ${acceptedSubmission.status === "queued" ? "排队中" : "已写入对话记录"}` : " · 已结算或等待展示更新"}
            </p>
          )}
          {snapshot?.submissions.filter((submission) => submission.status === "queued").map((submission) => (
            <div className="mx-auto flex max-w-3xl items-center justify-between rounded-md border px-3 py-2 text-xs text-muted-foreground" key={submission.id}>
              <span>输入 #{submission.id} 正在 Runner 队列中，尚未写入对话记录。</span>
              {submission.type === "input" && <Button disabled={busy} onClick={() => void onWithdrawSubmission(submission.id)} size="sm" variant="outline">撤回排队输入</Button>}
            </div>
          ))}
          {snapshot?.activeTasks.length ? (
            <section className="mx-auto max-w-3xl rounded-lg border bg-surface p-3" aria-label="Task Graph">
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">当前 Task Graph</h3>
              <div className="space-y-1">
                {snapshot.activeTasks.map((task) => (
                  <div className={`flex flex-wrap gap-x-2 text-xs ${task.owner !== null ? "pl-5" : ""}`} key={task.id}>
                    <span className="font-medium">{task.kind} #{task.id}</span>
                    <span>{task.status}{task.phase ? ` · ${task.phase}` : ""}</span>
                    {task.owner !== null && <span className="text-muted-foreground">owner #{task.owner}</span>}
                    {task.background && <span className="text-muted-foreground">后台</span>}
                    {task.abortRequested && <span className="text-warning">正在停止</span>}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {executing && <p className="text-sm text-muted-foreground">pi-durable 正在执行…</p>}
          {hasLiveTasks && !executing && <p className="text-sm text-muted-foreground">pi-durable 有待处理工作…</p>}
          {!snapshot && <p className="mx-auto mt-24 max-w-md text-center text-sm text-muted-foreground">选择一个 Conversation，或选择 Bot 后创建新的 Conversation。</p>}
        </div>

        <form className="border-t bg-background p-4" onSubmit={(event) => void onSubmit(event)}>
          <div className="mx-auto flex max-w-4xl items-end gap-2">
            <Textarea
              aria-label="发送消息"
              className="max-h-40 min-h-12 resize-y"
              disabled={!snapshot || busy || pendingSubmission !== null}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="发送消息…（Enter 发送，Shift+Enter 换行）"
              value={input}
            />
            <Button
              disabled={!snapshot || busy || !input.trim() || (pendingSubmission !== null && pendingSubmission.conversationId !== conversationId)}
              type="submit"
            >
              {pendingSubmission ? "重试" : "发送"}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Runner 操作失败";
}
