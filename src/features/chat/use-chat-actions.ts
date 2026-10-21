import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { ConversationSnapshot, DraftAttachment } from "@/app/runner-client";
import {
  captureRunnerSession,
  errorMessage,
  runnerKeys,
  snapshotOptions,
  useCatalogCache,
} from "@/app/runner-queries";
import { useOperation } from "@/app/use-operation";
import { useChatDraft, useWorkspaceResources } from "@/app/workspace-provider";

const emptyAttachments: DraftAttachment[] = [];

export function useChatActions(
  botId: string,
  conversationId: number | null,
  snapshot: ConversationSnapshot | null,
  supportsAttachments = false,
) {
  const { client, drafts } = useWorkspaceResources();
  const cache = useQueryClient();
  const updateCatalog = useCatalogCache();
  const operation = useOperation(["chat", conversationId]);
  const input = useChatDraft((state) =>
    conversationId === null ? "" : (state.inputsByConversation[conversationId] ?? ""),
  );
  const pendingSubmission = useChatDraft((state) => state.pendingSubmission);
  const submittingBotId = useChatDraft((state) => state.submittingBotId);
  const attachments = useChatDraft((state) =>
    conversationId === null
      ? emptyAttachments
      : (state.attachmentsByConversation[conversationId] ?? emptyAttachments),
  );
  const error = useChatDraft((state) =>
    conversationId === null ? "" : (state.errors[conversationId] ?? ""),
  );
  const [pickingAttachments, setPickingAttachments] = useState(false);
  const goalState = useChatDraft((state) =>
    conversationId === null ? undefined : state.goals[conversationId],
  );
  const goalDraft =
    goalState?.updatedAt === snapshot?.goal.updatedAt
      ? (goalState?.value ?? "")
      : (snapshot?.goal.description ?? "");

  function setError(value: string) {
    if (conversationId === null) return;
    drafts.setState((state) => ({ errors: { ...state.errors, [conversationId]: value } }));
  }
  async function refresh(id: number, assertCurrent: () => void) {
    assertCurrent();
    await cache.cancelQueries({ queryKey: runnerKeys.snapshot(id) });
    assertCurrent();
    const snapshot = await cache.fetchQuery({ ...snapshotOptions(client, id), staleTime: 0 });
    await cache.invalidateQueries({ queryKey: runnerKeys.botSummaries });
    return snapshot;
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
    if (conversationId === null) return false;
    const state = drafts.getState();
    const raw = state.inputsByConversation[conversationId] ?? "";
    const text = raw.trim();
    const currentAttachments = state.attachmentsByConversation[conversationId] ?? [];
    const pendingForConversation = state.pendingSubmission?.conversationId === conversationId;
    if (!pendingForConversation && !text && currentAttachments.length === 0) return false;
    if (currentAttachments.length > 0 && !supportsAttachments) {
      setError("当前 Runner 版本不支持附件，请重新连接后重试。");
      return false;
    }
    if (state.submittingBotId !== null) {
      setError("上一条提交仍在确认或刷新，请稍后重试。");
      return false;
    }
    if (state.pendingSubmission && !pendingForConversation) {
      setError("上一条提交结果尚未确认。返回原 Conversation 重试后再发送新消息。");
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
      revision: state.revisionsByConversation[conversationId] ?? 0,
      requestId: crypto.randomUUID(),
      attachments: currentAttachments.map(({ id, name }) => ({ id, name })),
    };
    drafts.setState({ pendingSubmission: attempt, submittingBotId: botId });
    setError("");
    try {
      const submission = await client.submit(
        attempt.conversationId,
        attempt.text,
        attempt.requestId,
        attempt.attachments,
      );
      if ("rejected" in submission) {
        drafts.setState((current) =>
          current.pendingSubmission?.requestId === attempt.requestId
            ? { pendingSubmission: null }
            : current,
        );
        setError(`${submission.message}。修正后可以重新发送。`);
        return false;
      }
      assertCurrent();
      drafts.setState((current) => ({
        pendingSubmission: null,
        attachmentsByConversation: {
          ...current.attachmentsByConversation,
          [attempt.conversationId]: (
            current.attachmentsByConversation[attempt.conversationId] ?? []
          ).filter((attachment) => !attempt.attachments.some((item) => item.id === attachment.id)),
        },
        inputsByConversation:
          (current.revisionsByConversation[attempt.conversationId] ?? 0) === attempt.revision
            ? { ...current.inputsByConversation, [attempt.conversationId]: "" }
            : current.inputsByConversation,
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

  async function pickAttachments() {
    if (
      conversationId === null ||
      !supportsAttachments ||
      pickingAttachments ||
      drafts.getState().pendingSubmission !== null
    ) {
      return false;
    }
    const targetConversationId = conversationId;
    const current = drafts.getState().attachmentsByConversation[targetConversationId] ?? [];
    const remaining = 3 - current.length;
    if (remaining <= 0) {
      setError("每条消息最多添加 3 个附件。");
      return false;
    }
    let assertCurrent: () => void;
    try {
      assertCurrent = captureRunnerSession(cache);
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
    setPickingAttachments(true);
    setError("");
    try {
      const selected = await client.pickAttachments(remaining);
      try {
        assertCurrent();
      } catch (cause) {
        let cleanupFailed = false;
        try {
          await client.deleteAttachments(selected.map(({ id }) => id));
        } catch {
          cleanupFailed = true;
        }
        setError(
          cleanupFailed
            ? `${errorMessage(cause)} 已选附件已丢弃，但暂存文件未能立即删除，会在后续过期清理时处理。`
            : `${errorMessage(cause)} 已选附件已丢弃，请重新选择。`,
        );
        return false;
      }
      const latest = drafts.getState();
      const latestAttachments = latest.attachmentsByConversation[targetConversationId] ?? [];
      if (latest.pendingSubmission !== null || latestAttachments.length + selected.length > 3) {
        await client.deleteAttachments(selected.map(({ id }) => id));
        setError("附件状态已变化，请重新选择。");
        return false;
      }
      if (selected.some(({ size }) => !Number.isSafeInteger(size) || size < 0)) {
        await client.deleteAttachments(selected.map(({ id }) => id));
        setError("所选附件信息无效，请重新选择。");
        return false;
      }
      const totalBytes = [...latestAttachments, ...selected].reduce(
        (total, attachment) => total + attachment.size,
        0,
      );
      if (totalBytes > 8 * 1024 * 1024) {
        await client.deleteAttachments(selected.map(({ id }) => id));
        setError("每条消息附件总大小不能超过 8 MiB。");
        return false;
      }
      drafts.getState().addAttachments(targetConversationId, selected);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setPickingAttachments(false);
    }
  }

  async function removeAttachment(attachment: DraftAttachment) {
    if (conversationId === null || drafts.getState().pendingSubmission !== null) return false;
    const targetConversationId = conversationId;
    drafts.getState().removeAttachments(targetConversationId, [attachment.id]);
    try {
      await client.deleteAttachments([attachment.id]);
      return true;
    } catch (cause) {
      setError(`附件已从输入中移除，暂存文件稍后自动清理：${errorMessage(cause)}`);
      return false;
    }
  }

  return {
    busy: operation.busy || submittingBotId === botId,
    operationBusy: operation.busy,
    submitting: submittingBotId !== null,
    error: error || operation.error,
    operationError: operation.error,
    input,
    attachments,
    supportsAttachments,
    pickingAttachments,
    pickAttachments,
    removeAttachment,
    setInput: (value: string) => {
      if (conversationId !== null) drafts.getState().setInput(conversationId, value);
    },
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
