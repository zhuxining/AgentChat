import { useEffect, useState } from "react";

import type {
  Bot,
  BotDraft,
  BotDefaults,
  ConfigurationStatus,
  ConversationSnapshot,
  ConversationSummary,
  InitializeResult,
  ProviderOption,
  RunnerCapabilities,
  runnerClient,
} from "@/app/runner-client";

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
  const [providers, setProviders] = useState<ProviderOption[]>([]);
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
  // Unsend drafts stay per Bot so switching views never discards what someone typed.
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
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
    setProviders(initial.providers ?? []);
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
        const firstBot = initial.bots.find((bot) => !bot.archived);
        setSelectedBotId(firstBot?.id ?? "");
        setConversationId(latestConversationId(initial.conversations, firstBot?.id) ?? null);
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
  const botConversations = conversations
    .filter((conversation) => conversation.botId === selectedBotId)
    .sort((left, right) => left.createdAt - right.createdAt);
  const input = inputs[selectedBotId] ?? "";
  function setInput(value: string) {
    setInputs((previous) => ({ ...previous, [selectedBotId]: value }));
  }
  const selectedBot = bots.find((bot) => bot.id === selectedBotId && !bot.archived);
  const linkedBot = bots.find((bot) => bot.id === snapshot?.conversation.botId);
  const activeBot = snapshot ? linkedBot : selectedBot;
  const hasLiveTasks = (snapshot?.activeTasks.length ?? 0) > 0;
  const executing = snapshot?.activeTasks.some((task) => task.status === "running") ?? false;
  const hasUpdatedBotSettings = Boolean(
    snapshot && linkedBot && linkedBot.configVersion !== snapshot.conversation.botConfigVersion,
  );
  const goalUpdatedAt = snapshot?.goal.updatedAt ?? null;
  const goalDraft =
    goalDraftState.conversationId === conversationId && goalDraftState.updatedAt === goalUpdatedAt
      ? goalDraftState.value
      : (snapshot?.goal.description ?? "");

  async function runAction<T>(operation: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function selectConversation(conversation: ConversationSummary) {
    setConversationId(conversation.id);
    setSelectedBotId(conversation.botId);
  }

  // Selecting a Bot always lands on its latest conversation; history stays reachable
  // because every conversation of the Bot is shown in one timeline.
  function selectBot(botId: string) {
    setSelectedBotId(botId);
    setConversationId(latestConversationId(conversations, botId) ?? null);
  }

  function startConversation(botId: string, cwd = "", goal = "") {
    return runAction(async () => {
      await openConversation(botId, cwd, goal);
      return true;
    });
  }

  async function openConversation(botId: string, cwd: string, goal: string) {
    const created = await client.createConversation(botId, cwd, goal);
    setConversations((previous) => [created, ...previous]);
    setConversationId(created.id);
  }

  function saveBot(botId: string | null, draft: BotDraft, configVersion?: string) {
    return runAction(async () => {
      if (botId) {
        if (!configVersion) throw new Error("缺少配置版本，请重新打开 Bot 编辑页。");
        const result = await client.updateBot(botId, draft, configVersion);
        setBots(result.bots);
        setSelectedBotId(result.bot.id);
        return result.bot;
      }
      const bot = await client.createBot(draft);
      setBots((previous) => [...previous, bot]);
      setSelectedBotId(bot.id);
      setConversationId(null);
      try {
        await openConversation(bot.id, "", "");
      } catch (cause) {
        // Creation succeeded. Keep the Bot selected so retrying chat never creates a duplicate.
        setError(`Bot 已创建，但打开聊天失败：${errorMessage(cause)}。可以点击“开始新对话”重试。`);
      }
      return bot;
    });
  }

  function archiveBot(bot: Bot) {
    return runAction(async () => {
      const result = await client.archiveBot(bot.id, bot.configVersion);
      setBots(result.bots);
      if (selectedBotId === bot.id) {
        const next = result.bots.find((item) => !item.archived);
        setSelectedBotId(next?.id ?? "");
        setConversationId(latestConversationId(conversations, next?.id) ?? null);
      }
      return true;
    });
  }

  function applyBotSettings() {
    if (conversationId === null) return Promise.resolve(false);
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
      return true;
    });
  }

  function saveGoal() {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      await client.saveGoal(conversationId, goalDraft);
      setStoredSnapshot(await client.snapshot(conversationId));
      return true;
    });
  }

  function setGoalStatus(status: "open" | "completed") {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      await client.setGoalStatus(conversationId, status);
      setStoredSnapshot(await client.snapshot(conversationId));
      return true;
    });
  }

  function refreshSelection(initial: InitializeResult) {
    acceptCatalog(initial);
    const nextBotId = initial.bots.some((bot) => bot.id === selectedBotId && !bot.archived)
      ? selectedBotId
      : (initial.bots.find((bot) => !bot.archived)?.id ?? "");
    setSelectedBotId(nextBotId);
    if (!initial.conversations.some((conversation) => conversation.id === conversationId))
      setConversationId(latestConversationId(initial.conversations, nextBotId));
  }

  function reloadConfiguration() {
    return runAction(async () => {
      const initial = await client.reloadConfiguration();
      refreshSelection(initial);
      return true;
    });
  }

  function saveConfiguration(path: string, version: string, content: string) {
    return runAction(async () => {
      await client.saveConfiguration(path, version, content);
      refreshSelection(await client.initialize());
      return true;
    });
  }

  function stopRunner() {
    setPollingPaused(true);
    return runAction(async () => {
      try {
        await client.stopRunner();
        setRunnerStopped(true);
        setRunnerUnavailable(true);
        setPollingError("");
        return true;
      } catch (cause) {
        setPollingPaused(false);
        throw cause;
      }
    });
  }

  function restartRunner() {
    setPollingPaused(true);
    return runAction(async () => {
      try {
        await client.restartRunner();
        const initial = await client.initialize();
        refreshSelection(initial);
        setRunnerStopped(false);
        setPollingPaused(false);
        return true;
      } catch (cause) {
        setRunnerUnavailable(true);
        throw cause;
      }
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
      try {
        await client.submit(attempt.conversationId, attempt.text, attempt.requestId);
      } catch (cause) {
        throw new Error(`${errorMessage(cause)}。接纳结果尚未确认，重试会复用同一 requestId。`);
      }
      setPendingSubmission(null);
      setInput("");
      try {
        setStoredSnapshot(await client.snapshot(conversationId));
      } catch (cause) {
        setError(`输入已被 Runner 接纳，但刷新展示失败：${errorMessage(cause)}`);
      }
      return true;
    });
  }

  function abort() {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      await client.abort(conversationId);
      setStoredSnapshot(await client.snapshot(conversationId));
      return true;
    });
  }

  function withdrawSubmission(submissionId: number) {
    if (conversationId === null) return Promise.resolve(false);
    return runAction(async () => {
      const result = await client.abortSubmission(conversationId, submissionId);
      setStoredSnapshot(await client.snapshot(conversationId));
      // 已撤回无需提示；未撤回的原因需要用户知道。
      if (result.status !== "aborted") {
        setError(
          result.status === "already_placed"
            ? "输入已进入执行记录，无法再按排队输入撤回。"
            : "该输入已结束或当前不存在。",
        );
      }
      return true;
    });
  }

  return {
    catalog: { bots, conversations, capabilities, botDefaults, configuration, providers },
    selection: {
      conversationId,
      selectedBotId,
      selectedBot,
      activeBot,
      snapshot,
      botConversations,
    },
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
    feedback: { error: error || pollingError },
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
      submitMessage,
      abort,
      withdrawSubmission,
    },
    actions: {
      selectConversation,
      selectBot,
      startConversation,
      saveBot,
      archiveBot,
      applyBotSettings,
      saveGoal,
      setGoalStatus,
      restartRunner,
      stopRunner,
      reloadConfiguration,
      readConfiguration: client.readConfiguration,
      saveConfiguration,
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

function latestConversationId(conversations: ConversationSummary[], botId: string | undefined) {
  if (!botId) return null;
  return (
    conversations
      .filter((conversation) => conversation.botId === botId)
      .sort((left, right) => right.createdAt - left.createdAt)[0]?.id ?? null
  );
}
