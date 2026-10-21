import { useRunnerCatalog, useRunnerLifecycle } from "@/app/runner-queries";
import { useBotSelection, useRouteBotId } from "@/features/bots/bot-queries";
import { useBotActions } from "@/features/bots/use-bot-actions";
import { useChatActions } from "@/features/chat/use-chat-actions";
import { useRunnerActions } from "@/features/settings/use-runner-actions";

// Chat and its detail pane share workflows, while subscribing directly to their data.
export function useBotChat() {
  const botId = useRouteBotId();
  const query = useRunnerCatalog();
  const selection = useBotSelection(botId);
  const lifecycle = useRunnerLifecycle();
  const supportsAttachments = query.data?.queryCapabilities?.attachments === true;
  const chat = useChatActions(
    botId,
    selection.conversationId,
    selection.snapshot,
    supportsAttachments,
  );
  const bots = useBotActions();
  const runner = useRunnerActions();
  const snapshot = selection.snapshot;
  return {
    catalog: {
      bots: query.data?.bots ?? [],
      conversations: query.data?.conversations ?? [],
      capabilities: query.data?.capabilities ?? { extensions: [], tools: [] },
      botDefaults: query.data?.botDefaults ?? null,
      configuration: query.data?.configuration ?? null,
      providers: query.data?.providers ?? [],
    },
    selection,
    connection: {
      loading: query.isPending,
      busy: chat.busy || bots.busy || runner.busy,
      composerBusy: chat.operationBusy || bots.busy || runner.busy,
      runnerUnavailable:
        lifecycle.paused ||
        lifecycle.stopped ||
        lifecycle.failed ||
        query.isError ||
        Boolean(selection.snapshotError),
      ready: query.data?.configuration.ready ?? false,
      providerConfigured: snapshot?.apiKeyConfigured ?? query.data?.apiKeyConfigured ?? false,
      credentialWarning: query.data?.credentialWarning ?? "",
      supportsAttachments,
    },
    feedback: {
      error:
        chat.error ||
        bots.error ||
        runner.error ||
        selection.snapshotError?.message ||
        query.error?.message ||
        "",
    },
    operationError: chat.operationError || bots.error || runner.error,
    conversation: {
      hasLiveTasks: (snapshot?.activeTasks.length ?? 0) > 0,
      executing: snapshot?.activeTasks.some((task) => task.status === "running") ?? false,
      hasUpdatedBotSettings: Boolean(
        snapshot &&
        selection.selectedBot &&
        selection.selectedBot.configVersion !== snapshot.conversation.botConfigVersion,
      ),
      goalDraft: chat.goalDraft,
      setGoalDraft: chat.setGoalDraft,
    },
    messaging: chat,
    actions: {
      ...bots,
      applyBotSettings: chat.applyBotSettings,
      saveGoal: chat.saveGoal,
      setGoalStatus: chat.setGoalStatus,
      restartRunner: runner.restartRunner,
    },
  };
}
