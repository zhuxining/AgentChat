import { useEffect, useState } from "react";

import type {
  Bot,
  BotDraft,
  BotDefaults,
  ConfigurationStatus,
  ConversationSnapshot,
  ConversationSummary,
  InitializeResult,
  RunnerCapabilities,
  runnerClient,
} from "@/app/runner-client";
import { initializeBotDraft } from "@/features/chat/bot-draft";

type RunnerClient = typeof runnerClient;
type PendingSubmission = { conversationId: number; text: string; requestId: string };

// Owns Runner synchronization and cross-view workflows. Views submit user intent rather than
// coordinating IPC ordering, polling, accepted-input retries, or partial Bot creation themselves.
export function useWorkspace(client: RunnerClient) {
  const [botDefaults, setBotDefaults] = useState<BotDefaults | null>(null);
  const [configuration, setConfiguration] = useState<ConfigurationStatus | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [runnerStopped, setRunnerStopped] = useState(false);
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
  const [pollingError, setPollingError] = useState("");
  const [notice, setNotice] = useState("");
  const [input, setInput] = useState("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [acceptedSubmission, setAcceptedSubmission] = useState<{
    conversationId: number;
    id: number;
  } | null>(null);
  const [goalDraftState, setGoalDraftState] = useState<{
    conversationId: number | null;
    updatedAt: number | null;
    value: string;
  }>({ conversationId: null, updatedAt: null, value: "" });

  function acceptCatalog(initial: InitializeResult) {
    setBotDefaults(initial.botDefaults);
    setConfiguration(initial.configuration);
    setBots(initial.bots);
    setConversations(initial.conversations);
    setCapabilities(initial.capabilities);
    setProviderConfigured(initial.apiKeyConfigured);
    setRuntimeVersion(initial.runtimeVersion);
    setCredentialWarning(initial.credentialWarning ?? "");
    setRunnerUnavailable(false);
    setPollingError("");
  }

  useEffect(() => {
    let mounted = true;
    void client
      .initialize()
      .then((initial) => {
        if (!mounted) return;
        acceptCatalog(initial);
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
  }, [client]);

  useEffect(() => {
    if (conversationId === null || pollingPaused) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const value = await client.snapshot(conversationId);
        if (active) {
          setStoredSnapshot(value);
          setProviderConfigured(value.apiKeyConfigured);
          setRunnerUnavailable(false);
          setPollingError("");
        }
      } catch (cause) {
        if (active) {
          setRunnerUnavailable(true);
          setPollingError(errorMessage(cause));
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
  }, [client, conversationId, pollingPaused]);

  const snapshot = storedSnapshot?.conversation.id === conversationId ? storedSnapshot : null;
  const selectedBot = bots.find((bot) => bot.id === selectedBotId && !bot.archived);
  const linkedBot = bots.find((bot) => bot.id === snapshot?.conversation.botId);
  const activeBot = snapshot ? linkedBot : selectedBot;
  const hasLiveTasks = (snapshot?.activeTasks.length ?? 0) > 0;
  const executing = snapshot?.activeTasks.some((task) => task.status === "running") ?? false;
  const hasUpdatedBotSettings = Boolean(
    snapshot && linkedBot && linkedBot.configVersion !== snapshot.conversation.botConfigVersion,
  );
  const currentAcceptedSubmissionId =
    acceptedSubmission?.conversationId === conversationId ? acceptedSubmission.id : null;
  const acceptedSubmissionStatus = snapshot?.submissions.find(
    (submission) => submission.id === currentAcceptedSubmissionId,
  );
  const goalUpdatedAt = snapshot?.goal.updatedAt ?? null;
  const goalDraft =
    goalDraftState.conversationId === conversationId && goalDraftState.updatedAt === goalUpdatedAt
      ? goalDraftState.value
      : (snapshot?.goal.description ?? "");

  async function runAction(operation: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await operation();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function selectConversation(conversation: ConversationSummary) {
    setConversationId(conversation.id);
    setSelectedBotId(conversation.botId);
  }

  async function openConversation(botId: string, cwd: string, goal: string) {
    const created = await client.createConversation(botId, cwd, goal);
    setConversations((previous) => [created, ...previous]);
    setConversationId(created.id);
  }

  function saveBot(botId: string | null, draft: BotDraft, configVersion?: string) {
    setNotice("");
    return runAction(async () => {
      if (botId) {
        if (!configVersion) throw new Error("缺少配置版本，请重新打开智能体编辑框。");
        const result = await client.updateBot(botId, draft, configVersion);
        setBots(result.bots);
        setSelectedBotId(result.bot.id);
        setNotice(`已保存 ${result.bot.name} 的新配置。现有 Conversation 不会自动改变。`);
        return;
      }
      const bot = await client.createBot(draft);
      setBots((previous) => [...previous, bot]);
      setSelectedBotId(bot.id);
      setConversationId(null);
      setNotice(`已创建 ${bot.name}。`);
      try {
        await openConversation(bot.id, "", "");
      } catch (cause) {
        // Creation succeeded. Keep the Bot selected so retrying chat never creates a duplicate.
        setError(`智能体已创建，但打开聊天失败：${errorMessage(cause)}。可以点击“开始聊天”重试。`);
      }
    });
  }

  function startChat(cwd = "", goal = "") {
    return runAction(async () => {
      let bot = selectedBot;
      if (!bot) {
        if (!botDefaults) throw new Error("尚未取得 Runner 的智能体默认配置。");
        bot = await client.createBot({ ...initializeBotDraft(null, botDefaults), name: "幕僚长" });
        const created = bot;
        setBots((previous) => [...previous, created]);
        setSelectedBotId(bot.id);
      }
      await openConversation(bot.id, cwd, goal);
    });
  }

  function archiveBot(bot: Bot) {
    return runAction(async () => {
      const result = await client.archiveBot(bot.id, bot.configVersion);
      setBots(result.bots);
      if (selectedBotId === bot.id)
        setSelectedBotId(result.bots.find((item) => !item.archived)?.id ?? "");
      setNotice(`${bot.name} 已归档；已有聊天保留关联。`);
    });
  }

  function applyBotSettings() {
    if (conversationId === null) return Promise.resolve(false);
    setNotice("");
    return runAction(async () => {
      const result = await client.applyBotSettings(conversationId);
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, botConfigVersion: result.botConfigVersion }
            : conversation,
        ),
      );
      setStoredSnapshot(await client.snapshot(conversationId));
      setNotice("Bot 设置已应用到此 Conversation。");
    });
  }

  function saveGoal() {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      await client.saveGoal(conversationId, goalDraft);
      setStoredSnapshot(await client.snapshot(conversationId));
      setNotice("工作目标已保存。");
    });
  }

  function setGoalStatus(status: "open" | "completed") {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      await client.setGoalStatus(conversationId, status);
      setStoredSnapshot(await client.snapshot(conversationId));
    });
  }

  function refreshSelection(initial: InitializeResult) {
    acceptCatalog(initial);
    setSelectedBotId((previous) =>
      initial.bots.some((bot) => bot.id === previous && !bot.archived)
        ? previous
        : (initial.bots.find((bot) => !bot.archived)?.id ?? ""),
    );
    if (!initial.conversations.some((conversation) => conversation.id === conversationId))
      setConversationId(initial.conversations[0]?.id ?? null);
  }

  function reloadConfiguration() {
    setNotice("");
    return runAction(async () => {
      const initial = await client.reloadConfiguration();
      refreshSelection(initial);
      setNotice(
        initial.configuration.errors.length
          ? "配置重载已完成，部分磁盘修改未生效，请查看配置错误。"
          : "配置已重载。智能体默认配置用于后续执行，已有执行需显式应用。",
      );
    });
  }

  function saveConfiguration(path: string, version: string, content: string) {
    setNotice("");
    return runAction(async () => {
      await client.saveConfiguration(path, version, content);
      refreshSelection(await client.initialize());
      setNotice("配置文件已保存并重载。已有执行的配置不会自动改变。");
    });
  }

  function stopRunner() {
    setNotice("");
    setPollingPaused(true);
    return runAction(async () => {
      try {
        await client.stopRunner();
        setRunnerStopped(true);
        setRunnerUnavailable(true);
        setPollingError("");
        setNotice("后台 Runner 已停止，未完成工作保留恢复状态。可以随时启动并连接。");
      } catch (cause) {
        setPollingPaused(false);
        throw cause;
      }
    });
  }

  function restartRunner() {
    setNotice("");
    setPollingPaused(true);
    return runAction(async () => {
      try {
        await client.restartRunner();
        const initial = await client.initialize();
        refreshSelection(initial);
        setRunnerStopped(false);
        setPollingPaused(false);
        setNotice("Runner 已重新启动，pi-durable 正在恢复未完成工作。");
      } catch (cause) {
        setRunnerUnavailable(true);
        throw cause;
      }
    });
  }

  function setProviderCredential(apiKey: string | null) {
    setNotice("");
    return runAction(async () => {
      const result = await client.setProviderCredential(apiKey);
      setProviderConfigured(result.configured);
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
    });
  }

  function submitMessage() {
    const text = input.trim();
    if (conversationId === null || !text) return Promise.resolve(false);
    if (
      pendingSubmission &&
      (pendingSubmission.conversationId !== conversationId || pendingSubmission.text !== text)
    ) {
      setError("上一条提交结果尚未确认。返回原 Conversation 重试，确认前不要更改输入。");
      return Promise.resolve(false);
    }
    const attempt = pendingSubmission ?? { conversationId, text, requestId: crypto.randomUUID() };
    setPendingSubmission(attempt);
    return runAction(async () => {
      let accepted: { id: number };
      try {
        accepted = await client.submit(attempt.conversationId, attempt.text, attempt.requestId);
      } catch (cause) {
        throw new Error(`${errorMessage(cause)}。接纳结果尚未确认，重试会复用同一 requestId。`);
      }
      setAcceptedSubmission({ conversationId, id: accepted.id });
      setPendingSubmission(null);
      setInput("");
      try {
        setStoredSnapshot(await client.snapshot(conversationId));
      } catch (cause) {
        setError(`输入已被 Runner 接纳，但刷新展示失败：${errorMessage(cause)}`);
      }
    });
  }

  function abort() {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      await client.abort(conversationId);
      setStoredSnapshot(await client.snapshot(conversationId));
    });
  }

  function withdrawSubmission(submissionId: number) {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      const result = await client.abortSubmission(conversationId, submissionId);
      setStoredSnapshot(await client.snapshot(conversationId));
      setNotice(
        result.status === "aborted"
          ? "排队输入已撤回。"
          : result.status === "already_placed"
            ? "输入已进入执行记录，无法再按排队输入撤回。"
            : "该输入已结束或当前不存在。",
      );
    });
  }

  return {
    catalog: { bots, conversations, capabilities, botDefaults, configuration },
    selection: { conversationId, selectedBotId, selectedBot, activeBot, snapshot },
    connection: {
      loading,
      busy,
      runnerUnavailable,
      runnerStopped,
      ready: configuration?.ready ?? false,
      providerConfigured,
      runtimeVersion,
      credentialWarning,
    },
    feedback: { error: error || pollingError, notice, dismissNotice: () => setNotice("") },
    conversation: {
      hasLiveTasks,
      executing,
      hasUpdatedBotSettings,
      goalDraft,
      setGoalDraft: (value: string) =>
        setGoalDraftState({ conversationId, updatedAt: goalUpdatedAt, value }),
    },
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
    actions: {
      selectConversation,
      selectBot: setSelectedBotId,
      saveBot,
      startChat,
      archiveBot,
      applyBotSettings,
      saveGoal,
      setGoalStatus,
      restartRunner,
      stopRunner,
      reloadConfiguration,
      readConfiguration: client.readConfiguration,
      saveConfiguration,
      setProviderCredential,
    },
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "操作失败，请重试";
}
