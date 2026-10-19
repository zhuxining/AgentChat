import { useQueryClient } from "@tanstack/react-query";

import type { ConversationSnapshot } from "@/app/runner-client";
import {
  captureRunnerSession,
  errorMessage,
  runnerKeys,
  snapshotOptions,
  useCatalogCache,
} from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useChatDraft, useWorkspaceResources } from "@/app/workspace-provider";

export function useChatActions(
  botId: string,
  conversationId: number | null,
  snapshot: ConversationSnapshot | null,
) {
  const { client, drafts } = useWorkspaceResources();
  const cache = useQueryClient();
  const updateCatalog = useCatalogCache();
  const operation = useOperation(["chat", conversationId]);
  const input = useChatDraft((state) => state.inputsByBot[botId] ?? "");
  const pendingSubmission = useChatDraft((state) => state.pendingSubmission);
  const submittingBotId = useChatDraft((state) => state.submittingBotId);
  const error = useChatDraft((state) => state.errors[botId] ?? "");
  const goalState = useChatDraft((state) =>
    conversationId === null ? undefined : state.goals[conversationId],
  );
  const goalDraft =
    goalState?.updatedAt === snapshot?.goal.updatedAt
      ? (goalState?.value ?? "")
      : (snapshot?.goal.description ?? "");

  function setError(value: string) {
    drafts.setState((state) => ({ errors: { ...state.errors, [botId]: value } }));
  }
  async function refresh(id: number, assertCurrent: () => void) {
    assertCurrent();
    await cache.cancelQueries({ queryKey: runnerKeys.snapshot(id) });
    assertCurrent();
    return cache.fetchQuery({ ...snapshotOptions(client, id), staleTime: 0 });
  }
  function changeConversation(action: (id: number, assertCurrent: () => void) => Promise<unknown>) {
    if (conversationId === null) return Promise.resolve(false);
    const id = conversationId;
    return operation.runAction(async () => {
      const assertCurrent = captureRunnerSession(cache);
      setError("");
      await action(id, assertCurrent);
      await refresh(id, assertCurrent);
      return true;
    });
  }
  async function submitMessage() {
    const state = drafts.getState();
    const raw = state.inputsByBot[botId] ?? "";
    const text = raw.trim();
    if (conversationId === null || !text) return false;
    if (state.submittingBotId !== null) {
      setError("上一条提交仍在确认或刷新，请稍后重试。");
      return false;
    }
    if (
      state.pendingSubmission &&
      (state.pendingSubmission.conversationId !== conversationId ||
        state.pendingSubmission.text !== text)
    ) {
      setError("上一条提交结果尚未确认。返回原 Conversation 重试，确认前不要更改输入。");
      return false;
    }
    let assertCurrent: () => void;
    try {
      assertCurrent = captureRunnerSession(cache);
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
    const attempt = state.pendingSubmission ?? {
      botId,
      conversationId,
      text,
      revision: state.revisions[botId] ?? 0,
      requestId: crypto.randomUUID(),
    };
    drafts.setState({ pendingSubmission: attempt, submittingBotId: botId });
    setError("");
    try {
      await client.submit(attempt.conversationId, attempt.text, attempt.requestId);
      drafts.setState((current) => ({
        pendingSubmission: null,
        inputsByBot:
          (current.revisions[attempt.botId] ?? 0) === attempt.revision
            ? { ...current.inputsByBot, [attempt.botId]: "" }
            : current.inputsByBot,
      }));
      try {
        await refresh(attempt.conversationId, assertCurrent);
      } catch (cause) {
        setError(`输入已被 Runner 接纳，但刷新展示失败：${errorMessage(cause)}`);
      }
      return true;
    } catch (cause) {
      setError(`${errorMessage(cause)}。接纳结果尚未确认，重试会复用同一 requestId。`);
      return false;
    } finally {
      drafts.setState({ submittingBotId: null });
    }
  }

  return {
    busy: operation.busy || submittingBotId === botId,
    submitting: submittingBotId !== null,
    error: error || operation.error,
    operationError: operation.error,
    input,
    setInput: (value: string) => drafts.getState().setInput(botId, value),
    pendingSubmission,
    submitMessage,
    goalDraft,
    setGoalDraft: (value: string) => {
      if (conversationId !== null && snapshot)
        drafts.getState().setGoal(conversationId, snapshot.goal.updatedAt, value);
    },
    saveGoal: () => changeConversation((id) => client.saveGoal(id, goalDraft)),
    setGoalStatus: (status: "open" | "completed") =>
      changeConversation((id) => client.setGoalStatus(id, status)),
    abort: () => changeConversation((id) => client.abort(id)),
    applyBotSettings: () =>
      changeConversation(async (id, assertCurrent) => {
        const result = await client.applyBotSettings(id);
        assertCurrent();
        updateCatalog((current) => ({
          ...current,
          conversations: current.conversations.map((item) =>
            item.id === id ? { ...item, botConfigVersion: result.botConfigVersion } : item,
          ),
        }));
      }),
    withdrawSubmission: (submissionId: number) =>
      changeConversation(async (id) => {
        const result = await client.abortSubmission(id, submissionId);
        if (result.status !== "aborted")
          setError(
            result.status === "already_placed"
              ? "输入已进入执行记录，无法再按排队输入撤回。"
              : "该输入已结束或当前不存在。",
          );
      }),
  };
}
