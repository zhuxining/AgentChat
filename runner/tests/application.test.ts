import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createApplicationRunner } from "../src/application.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(models?: MutableModels) {
  const dataDir = await mkdtemp(join(tmpdir(), "agentchat-runner-"));
  temporaryDirectories.push(dataDir);
  const runner = await createApplicationRunner({ dataDir, models });
  return { dataDir, runner };
}

async function createBotAndConversation(
  runner: Awaited<ReturnType<typeof createApplicationRunner>>,
  modelId = "gpt-5-mini",
  cwd = process.cwd(),
  conversationCwd = "",
) {
  const bot = (await runner.handle({
    op: "createBot",
    name: "本地助手",
    modelId,
    instructions: "用简体中文回答。",
    cwd,
    thinkingLevel: "medium",
    extensions: ["coding-tools"],
    tools: ["bash", "edit", "read", "write"],
  })) as { id: string };
  const conversation = (await runner.handle({
    op: "createConversation",
    botId: bot.id,
    cwd: conversationCwd,
  })) as { id: number };
  return { bot, conversation };
}

function deterministicModels(delayMs = 0, honorAbort = false): MutableModels {
  const model: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "确定性回复" }],
    api: "openai-responses",
    provider: "openai",
    model: "test-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
  const stream: ProviderStreams["stream"] = (_model, _context, options) => {
    const events = createAssistantMessageEventStream();
    events.push({ type: "start", partial: { ...model, content: [], stopReason: "pending" } });
    const complete = () =>
      events.push({
        type: "done",
        reason: "stop",
        message: { ...model, content: [...model.content] },
      });
    const timer = delayMs > 0 ? setTimeout(complete, delayMs) : undefined;
    if (timer === undefined) queueMicrotask(complete);
    if (honorAbort) {
      options?.signal?.addEventListener(
        "abort",
        () => {
          if (timer !== undefined) clearTimeout(timer);
          events.push({
            type: "error",
            reason: "aborted",
            error: { ...model, stopReason: "aborted", errorMessage: "aborted" },
          });
        },
        { once: true },
      );
    }
    return events;
  };
  const provider = createProvider({
    id: "openai",
    auth: {
      apiKey: {
        name: "Deterministic test credential",
        resolve: async () => ({ auth: { apiKey: "test-only" } }),
      },
    },
    models: [
      {
        id: "test-model",
        name: "Deterministic test model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://test.invalid",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false,
        contextWindow: 8_192,
        maxTokens: 1_024,
      },
    ],
    api: { stream, streamSimple: stream },
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}

async function waitForActiveTask(
  runner: Awaited<ReturnType<typeof createApplicationRunner>>,
  conversationId: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = (await runner.handle({ op: "snapshot", conversationId })) as {
      activeTasks: unknown[];
    };
    if (snapshot.activeTasks.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("pi-durable 未在限定时间内启动 Conversation Task");
}

async function waitForReply(
  runner: Awaited<ReturnType<typeof createApplicationRunner>>,
  conversationId: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = (await runner.handle({ op: "snapshot", conversationId })) as {
      messages: { role: string; text: string }[];
    };
    if (
      snapshot.messages.some(
        (message) => message.role === "assistant" && message.text === "确定性回复",
      )
    ) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("pi-durable 未在限定时间内提交确定性回复");
}

describe("Runner application Interface", () => {
  it("persists Bot configuration and Conversation snapshot across Harness reopen", async () => {
    const { dataDir, runner } = await createFixture();
    const { bot, conversation } = await createBotAndConversation(runner);
    await runner.handle({ op: "close" });

    const reopened = await createApplicationRunner({ dataDir });
    try {
      const initialized = (await reopened.handle({ op: "initialize" })) as {
        bots: { id: string; instructions: string }[];
        conversations: { id: number; botId: string }[];
      };
      expect(initialized.bots).toContainEqual(
        expect.objectContaining({ id: bot.id, instructions: "用简体中文回答。" }),
      );
      expect(initialized.conversations).toContainEqual(
        expect.objectContaining({ id: conversation.id, botId: bot.id }),
      );
      const snapshot = (await reopened.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: {
          botName: string;
          agent: {
            model: { provider: string; modelId: string } | null;
            thinkingLevel: string;
            instructions: string;
            cwd: string;
            extensions: string[];
            tools: string[];
          };
        };
        messages: unknown[];
      };
      expect(snapshot.conversation.botName).toBe("本地助手");
      expect(snapshot.conversation.agent).toEqual({
        model: { provider: "openai", modelId: "gpt-5-mini" },
        thinkingLevel: "medium",
        instructions: "用简体中文回答。",
        cwd: process.cwd(),
        extensions: ["agentchat-work-goal", "coding-tools"],
        tools: ["bash", "edit", "read", "write"],
      });
      expect(snapshot.messages).toEqual([]);
    } finally {
      await reopened.handle({ op: "close" });
    }
  });

  it("uses the Runner data directory when a Bot has no cwd override", async () => {
    const { dataDir, runner } = await createFixture();
    try {
      const { conversation } = await createBotAndConversation(runner, "gpt-5-mini", "");
      const snapshot = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: { agent: { cwd: string } };
      };
      expect(snapshot.conversation.agent.cwd).toBe(dataDir);
    } finally {
      await runner.handle({ op: "close" });
    }
  });

  it("applies a Conversation cwd override to its Agent snapshot", async () => {
    const { runner } = await createFixture();
    try {
      const { conversation } = await createBotAndConversation(
        runner,
        "gpt-5-mini",
        "",
        "/tmp/agentchat-work",
      );
      const snapshot = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: { agent: { cwd: string } };
      };
      expect(snapshot.conversation.agent.cwd).toBe("/tmp/agentchat-work");
    } finally {
      await runner.handle({ op: "close" });
    }
  });

  it("keeps Conversation settings as a snapshot until an idle-only apply", async () => {
    const { runner } = await createFixture(deterministicModels());
    const { bot, conversation } = await createBotAndConversation(runner, "test-model");
    try {
      await runner.handle({
        op: "updateBot",
        botId: bot.id,
        name: "新版本地助手",
        modelId: "test-model",
        instructions: "更新后的指令。",
        cwd: "/tmp/agentchat-new-default",
        thinkingLevel: "high",
        extensions: ["coding-tools"],
        tools: ["read"],
      });

      const unchanged = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: {
          botRevision: number;
          agent: { instructions: string; cwd: string; thinkingLevel: string };
        };
      };
      expect(unchanged.conversation.botRevision).toBe(1);
      expect(unchanged.conversation.agent).toEqual(
        expect.objectContaining({
          instructions: "用简体中文回答。",
          cwd: process.cwd(),
          thinkingLevel: "medium",
        }),
      );

      await runner.handle({ op: "applyBotSettings", conversationId: conversation.id });
      const applied = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: {
          botName: string;
          botRevision: number;
          agent: { instructions: string; cwd: string; thinkingLevel: string; tools: string[] };
        };
      };
      expect(applied.conversation).toEqual(
        expect.objectContaining({ botName: "新版本地助手", botRevision: 2 }),
      );
      expect(applied.conversation.agent).toEqual(
        expect.objectContaining({
          instructions: "更新后的指令。",
          cwd: "/tmp/agentchat-new-default",
          thinkingLevel: "high",
          tools: ["read"],
        }),
      );
    } finally {
      await runner.handle({ op: "close" });
    }
  });

  it("rejects applying Bot changes while a Task is active", async () => {
    const { runner } = await createFixture(deterministicModels(800));
    const { bot, conversation } = await createBotAndConversation(runner, "test-model");
    try {
      await runner.handle({
        op: "submit",
        conversationId: conversation.id,
        text: "请等待并回答",
        requestId: "busy-update-1",
      });
      await waitForActiveTask(runner, conversation.id);
      await runner.handle({
        op: "updateBot",
        botId: bot.id,
        name: "更新中的助手",
        modelId: "test-model",
        instructions: "新指令",
        cwd: process.cwd(),
        thinkingLevel: "medium",
        extensions: ["coding-tools"],
        tools: ["read"],
      });
      await expect(
        runner.handle({ op: "applyBotSettings", conversationId: conversation.id }),
      ).rejects.toThrow("必须等它空闲后才能应用 Bot 设置");
      await waitForReply(runner, conversation.id);
    } finally {
      await runner.handle({ op: "close" });
    }
  });

  it("archives a Bot without breaking its existing Conversation and tracks explicit goal state", async () => {
    const { runner } = await createFixture();
    const { bot, conversation } = await createBotAndConversation(runner);
    try {
      await runner.handle({
        op: "saveGoal",
        conversationId: conversation.id,
        description: "修复并验证本机功能",
      });
      await runner.handle({
        op: "setGoalStatus",
        conversationId: conversation.id,
        status: "completed",
      });
      await runner.handle({ op: "archiveBot", botId: bot.id });

      const initialized = (await runner.handle({ op: "initialize" })) as {
        bots: { id: string; archived: boolean }[];
        conversations: { id: number; botId: string }[];
      };
      expect(initialized.bots).toContainEqual(
        expect.objectContaining({ id: bot.id, archived: true }),
      );
      expect(initialized.conversations).toContainEqual(
        expect.objectContaining({ id: conversation.id, botId: bot.id }),
      );
      await expect(
        runner.handle({ op: "createConversation", botId: bot.id, cwd: "", goal: "" }),
      ).rejects.toThrow("Bot 不存在或已归档");

      const snapshot = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: { botId: string };
        goal: { description: string; status: string; completedAt: number | null };
      };
      expect(snapshot.conversation.botId).toBe(bot.id);
      expect(snapshot.goal).toEqual(
        expect.objectContaining({
          description: "修复并验证本机功能",
          status: "completed",
          completedAt: expect.any(Number),
        }),
      );
    } finally {
      await runner.handle({ op: "close" });
    }
  });

  it("withdraws a queued Submission and stops active work through pi-durable", async () => {
    const { runner } = await createFixture(deterministicModels(10_000, true));
    const { conversation } = await createBotAndConversation(runner, "test-model");
    try {
      await runner.handle({
        op: "submit",
        conversationId: conversation.id,
        text: "当前工作",
        requestId: "abort-current-1",
      });
      await waitForActiveTask(runner, conversation.id);
      const queued = (await runner.handle({
        op: "submit",
        conversationId: conversation.id,
        text: "排队工作",
        requestId: "abort-queued-1",
      })) as { id: number };
      const beforeAbort = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        submissions: { id: number; status: string }[];
      };
      expect(beforeAbort.submissions).toContainEqual(
        expect.objectContaining({ id: queued.id, status: "queued" }),
      );

      const withdrawn = (await runner.handle({
        op: "abortSubmission",
        conversationId: conversation.id,
        submissionId: queued.id,
      })) as { status: string };
      expect(withdrawn.status).toBe("aborted");
      expect(await runner.handle({ op: "abort", conversationId: conversation.id })).toEqual({
        stopped: true,
      });

      const afterAbort = (await runner.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        activeTasks: unknown[];
        submissions: { id: number; status: string }[];
      };
      expect(afterAbort.activeTasks).toEqual([]);
    } finally {
      await runner.handle({ op: "close" });
    }
  });

  it("resumes an unfinished accepted run after Harness close and reopen", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agentchat-runner-resume-"));
    temporaryDirectories.push(dataDir);
    const initial = await createApplicationRunner({
      dataDir,
      models: deterministicModels(60_000, true),
    });
    const { bot, conversation } = await createBotAndConversation(initial, "test-model");
    await initial.handle({
      op: "submit",
      conversationId: conversation.id,
      text: "请在重启后继续",
      requestId: "resume-after-close-1",
    });
    await waitForActiveTask(initial, conversation.id);
    await initial.handle({ op: "close" });

    const reopened = await createApplicationRunner({ dataDir, models: deterministicModels() });
    try {
      const current = (await reopened.handle({
        op: "snapshot",
        conversationId: conversation.id,
      })) as {
        conversation: { botId: string };
        messages: { role: string; text: string }[];
      };
      expect(current.conversation.botId).toBe(bot.id);
      const completed = await waitForReply(reopened, conversation.id);
      expect(
        completed.messages.filter(
          (message) => message.role === "assistant" && message.text === "确定性回复",
        ),
      ).toHaveLength(1);
    } finally {
      await reopened.handle({ op: "close" });
    }
  });

  it("keeps the Provider key out of process and child tool environments", async () => {
    const priorApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-secret-that-must-not-reach-tools";
    const { runner } = await createFixture();
    try {
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
      const initialized = (await runner.handle({ op: "initialize" })) as {
        apiKeyConfigured: boolean;
      };
      expect(initialized.apiKeyConfigured).toBe(true);
      expect(await runner.handle({ op: "setProviderCredential", apiKey: null })).toEqual({
        configured: false,
      });
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
    } finally {
      await runner.handle({ op: "close" });
      if (priorApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorApiKey;
    }
  });

  it("returns the same Submission for a retried requestId and commits the model reply", async () => {
    const { runner } = await createFixture(deterministicModels());
    const { conversation } = await createBotAndConversation(runner, "test-model");
    try {
      const request = {
        op: "submit",
        conversationId: conversation.id,
        text: "请打招呼",
        requestId: "stable-request-1",
      };
      const first = (await runner.handle(request)) as { id: number };
      const retried = (await runner.handle(request)) as { id: number };
      expect(retried.id).toBe(first.id);

      const snapshot = await waitForReply(runner, conversation.id);
      expect(snapshot.messages).toContainEqual(
        expect.objectContaining({ role: "assistant", text: "确定性回复" }),
      );
    } finally {
      await runner.handle({ op: "close" });
    }
  });
});
