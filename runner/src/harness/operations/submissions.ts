import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import type { Harness, SubmissionId } from "@earendil-works/pi-durable";

import type { createAgentResolver } from "../agent.js";
import type { Mutate } from "./mutation-queue.js";
import { conversationById, requireAvailable } from "./shared.js";

const context = BACKGROUND_CONTEXT;

// Submission 生命周期：输入接纳、撤回与运行中止。接纳前必须确认执行配置仍可解析。
export function createSubmissionOperations(
  harness: Harness,
  models: MutableModels,
  resolver: ReturnType<typeof createAgentResolver>,
  mutate: Mutate,
) {
  return {
    submit: (input: { conversationId: number; text: string; requestId: string }) =>
      mutate(async () => {
        const conversation = await conversationById(harness, input.conversationId);
        await requireAvailable(harness, models, resolver, conversation.id);
        const submission = await conversation.submit(
          { type: "input", content: input.text, requestId: input.requestId },
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
