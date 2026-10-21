import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import type { Harness, SubmissionId } from "@earendil-works/pi-durable";

import type { createAgentResolver } from "../agent.js";
import {
  attachmentInput,
  type AttachmentReference,
  type PreparedAttachmentInput,
} from "../attachments.js";
import { SubmissionRejectedError } from "../submission-errors.js";
import type { Mutate } from "./mutation-queue.js";
import { conversationById, requireAvailable } from "./shared.js";

const context = BACKGROUND_CONTEXT;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "提交内容校验失败";
  if (/api.?key|token|authorization|credential|secret/i.test(message)) {
    return "执行配置校验失败，请检查 Runner 配置";
  }
  return message.slice(0, 500);
}

// Submission 生命周期：输入接纳、撤回与运行中止。接纳前必须确认执行配置仍可解析。
export function createSubmissionOperations(
  harness: Harness,
  models: MutableModels,
  resolver: ReturnType<typeof createAgentResolver>,
  mutate: Mutate,
  dataDir: string,
) {
  return {
    submit: (input: {
      conversationId: number;
      text: string;
      requestId: string;
      attachments?: AttachmentReference[];
    }) =>
      mutate(async () => {
        const conversation = await conversationById(harness, input.conversationId);
        // Recover an admitted request before inspecting configuration or temporary files.
        // Lookup failures remain ambiguous so the client keeps the same request ID.
        const existing = await harness.commit(
          (tx) => tx.submissionByRequest(conversation.id, input.requestId),
          context,
        );
        if (existing) {
          if (existing.type !== "input") throw new Error("请求 ID 已用于其他类型的提交");
          return { id: existing.id };
        }
        let prepared: PreparedAttachmentInput;
        try {
          await requireAvailable(harness, models, resolver, conversation.id);
          const attachment = await attachmentInput(dataDir, input.text, input.attachments ?? []);
          if (attachment.hasImages) {
            const agent = await conversation.agent(context);
            const model = agent.model
              ? models.getModel(agent.model.provider, agent.model.modelId)
              : undefined;
            if (!model?.input.includes("image")) {
              throw new Error("当前会话模型不支持图片输入，请切换到支持图片的模型后重试");
            }
          }
          prepared = attachment;
        } catch (error) {
          // These checks all complete before Harness admission. A rejection here is safe to
          // edit and retry with a new request ID; errors after submit begins remain ambiguous.
          throw new SubmissionRejectedError(errorMessage(error));
        }
        const submission = await conversation.submit(
          {
            type: "input",
            content: prepared.content,
            ...(prepared.entry ? { entry: prepared.entry } : {}),
            requestId: input.requestId,
          },
          context,
        );
        return { id: submission.id };
      }),
    abortSubmission: (id: number, submissionId: number) =>
      mutate(async () => {
        const conversation = await conversationById(harness, id);
        return {
          status: await harness.abortSubmission(
            submissionId as SubmissionId,
            context,
            conversation.id,
          ),
        };
      }),
    abort: (id: number) =>
      mutate(async () => {
        await (await conversationById(harness, id)).abort(context);
        return { stopped: true };
      }),
  };
}
