import { mkdtemp, readFile, realpath, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { defaultRunnerConfiguration } from "../src/config/schema.js";
import { openRunner, type Runner } from "../src/harness/open.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(models?: MutableModels) {
  const dataDir = await mkdtemp(join(tmpdir(), "agentchat-runner-"));
  directories.push(dataDir);
  if (models) {
    const configuration = defaultRunnerConfiguration();
    const model = models.getModels()[0];
    if (!model) throw new Error("测试需要一个确定性模型");
    configuration.botDefaults.model = { provider: model.provider, modelId: model.id };
    await writeFile(join(dataDir, "runner.json"), JSON.stringify(configuration));
  }
  return { dataDir, runner: await openRunner({ dataDir, models }) };
}
async function createChat(runner: Runner, modelId = "deepseek-chat", cwd = "") {
  const bot = await runner.createBot({
    name: "本地助手",
    model: { provider: "deepseek", modelId },
    instructions: "用简体中文回答。",
    ...(cwd ? { cwd } : {}),
  });
  const conversation = await runner.createConversation({ botId: bot.id, cwd: "", goal: "" });
  return { bot, conversation };
}
async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("执行未在限定时间内达到预期状态");
}
const active = (runner: Runner, id: number) =>
  until(
    () => runner.snapshot(id),
    (value) => value.activeTasks.length > 0,
  );
const reply = (runner: Runner, id: number) =>
  until(
    () => runner.snapshot(id),
    (value) =>
      value.messages.some(
        (message) => message.role === "assistant" && message.text === "确定性回复",
      ),
  );

function deterministicModels(
  delayMs = 0,
  honorAbort = false,
  providerId = "deepseek",
): MutableModels {
  const model: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "确定性回复" }],
    api: "openai-responses",
    provider: providerId,
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
    id: providerId,
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
        provider: providerId,
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

describe("Runner typed operations", () => {
  it("materializes Bot defaults and assigns separate stable workspaces", async () => {
    const { dataDir, runner } = await fixture();
    try {
      const { bot, conversation } = await createChat(runner);
      const another = await runner.createBot({ name: "另一个助手" });
      expect(bot.cwd).toBe(join(await realpath(dataDir), "workspaces", bot.id));
      expect(another.cwd).not.toBe(bot.cwd);
      expect((await runner.snapshot(conversation.id)).conversation.agent.cwd).toBe(bot.cwd);
      const stored = JSON.parse(await readFile(join(dataDir, "bots", bot.id, "bot.json"), "utf8"));
      expect(stored.agent.tools).toEqual(["bash", "edit", "read", "write"]);
      expect(stored).not.toHaveProperty("revision");
      expect(stored).not.toHaveProperty("configVersion");
    } finally {
      await runner.close();
    }
  });

  it("resolves supported models and rejects unavailable models before creating a Bot", async () => {
    const { runner } = await fixture();
    try {
      for (const modelId of ["deepseek-chat", "deepseek-reasoner"]) {
        const { conversation } = await createChat(runner, modelId);
        expect((await runner.snapshot(conversation.id)).conversation.agent.model).toEqual({
          provider: "deepseek",
          modelId,
        });
      }
      await expect(createChat(runner, "missing-model")).rejects.toThrow("当前不可用");
    } finally {
      await runner.close();
    }
  });

  it("keeps effective Agent choices until explicitly applied and restores them after reopen", async () => {
    const { runner, dataDir } = await fixture();
    const { bot, conversation } = await createChat(runner);
    try {
      const result = await runner.updateBot(
        bot.id,
        {
          name: "新版助手",
          instructions: "更新指令",
          tools: ["read"],
          cwd: join(dataDir, "project"),
        },
        bot.configVersion,
      );
      expect((await runner.snapshot(conversation.id)).conversation.agent.instructions).toBe(
        "用简体中文回答。",
      );
      await runner.applyBotSettings(conversation.id);
      const snapshot = await runner.snapshot(conversation.id);
      expect(snapshot.conversation.agent).toMatchObject({
        instructions: "更新指令",
        tools: ["read"],
        cwd: join(dataDir, "project"),
      });
      expect(snapshot.conversation.botConfigVersion).toBe(result.bot.configVersion);
    } finally {
      await runner.close();
    }
    const reopened = await openRunner({ dataDir });
    try {
      expect((await reopened.initialize()).conversations).toContainEqual(
        expect.objectContaining({ id: conversation.id, botId: bot.id }),
      );
      expect((await reopened.snapshot(conversation.id)).conversation.agent.instructions).toBe(
        "更新指令",
      );
    } finally {
      await reopened.close();
    }
  });

  it("loads independent Bot edits only on reload and rejects stale UI saves", async () => {
    const { runner, dataDir } = await fixture();
    try {
      const { bot, conversation } = await createChat(runner);
      const path = join(dataDir, "bots", bot.id, "bot.json");
      const raw = JSON.parse(await readFile(path, "utf8"));
      raw.agent.instructions = "从文件加载";
      await writeFile(path, JSON.stringify(raw));
      expect((await runner.initialize()).bots[0]?.instructions).toBe("用简体中文回答。");
      await expect(
        runner.updateBot(bot.id, { name: "过期修改" }, bot.configVersion),
      ).rejects.toThrow("配置已被修改");
      const loaded = await runner.reloadConfiguration();
      expect(loaded.bots[0]?.instructions).toBe("从文件加载");
      expect((await runner.snapshot(conversation.id)).conversation.agent.instructions).toBe(
        "用简体中文回答。",
      );
    } finally {
      await runner.close();
    }
  });

  it("offers provider and model choices so the UI can use direct selection", async () => {
    const { runner } = await fixture();
    try {
      const initialized = await runner.initialize();
      expect(initialized.providers).toContainEqual(
        expect.objectContaining({
          name: "deepseek",
          models: expect.arrayContaining(["deepseek-chat", "deepseek-reasoner"]),
        }),
      );
    } finally {
      await runner.close();
    }
  });

  it("blocks a broken or missing Bot config without destroying accepted execution state", async () => {
    const { runner, dataDir } = await fixture();
    try {
      const { bot, conversation } = await createChat(runner);
      const path = join(dataDir, "bots", bot.id, "bot.json");
      await writeFile(path, "{broken");
      const invalid = await runner.reloadConfiguration();
      expect(invalid.configuration.errors).not.toHaveLength(0);
      await expect(runner.createConversation({ botId: bot.id, cwd: "", goal: "" })).rejects.toThrow(
        "Bot 配置缺失或无效",
      );
      await unlink(path);
      await runner.reloadConfiguration();
      expect((await runner.snapshot(conversation.id)).conversation.botId).toBe(bot.id);
      expect((await runner.initialize()).conversations).toHaveLength(1);
    } finally {
      await runner.close();
    }
  });

  it("keeps instructionsFile contents in the effective execution snapshot", async () => {
    const { runner, dataDir } = await fixture();
    try {
      const bot = await runner.createBot({ name: "文件指令" });
      const path = join(dataDir, "bots", bot.id, "bot.json");
      const raw = JSON.parse(await readFile(path, "utf8"));
      delete raw.agent.instructions;
      raw.agent.instructionsFile = "instructions.md";
      await writeFile(join(dataDir, "bots", bot.id, "instructions.md"), "第一版指令");
      await writeFile(path, JSON.stringify(raw));
      await runner.reloadConfiguration();
      const conversation = await runner.createConversation({ botId: bot.id, cwd: "", goal: "" });
      await writeFile(join(dataDir, "bots", bot.id, "instructions.md"), "第二版指令");
      await runner.reloadConfiguration();
      expect((await runner.snapshot(conversation.id)).conversation.agent.instructions).toBe(
        "第一版指令",
      );
      await runner.applyBotSettings(conversation.id);
      expect((await runner.snapshot(conversation.id)).conversation.agent.instructions).toBe(
        "第二版指令",
      );
    } finally {
      await runner.close();
    }
  });

  it("projects bounded summaries during execution and keeps them when reopening the Bot", async () => {
    const { runner } = await fixture(deterministicModels(400, true));
    try {
      const { bot, conversation } = await createChat(runner, "test-model");
      await runner.submit({
        conversationId: conversation.id,
        text: "界".repeat(200),
        requestId: "summary-run",
      });
      const running = await until(
        () => runner.botSummaries(),
        (items) => items.some((item) => item.executing),
      );
      expect(running).toEqual([
        {
          botId: bot.id,
          conversationId: conversation.id,
          latestMessage: "界".repeat(160),
          executing: true,
        },
      ]);
      await reply(runner, conversation.id);
      expect((await runner.botSummaries())[0]?.latestMessage).toBe("确定性回复");
      const reopened = await runner.createConversation({ botId: bot.id, cwd: "", goal: "" });
      expect(await runner.botSummaries()).toEqual([
        {
          botId: bot.id,
          conversationId: conversation.id,
          latestMessage: "确定性回复",
          executing: false,
        },
      ]);
      expect(reopened.id).toBe(conversation.id);
    } finally {
      await runner.close();
    }
  });

  it("does not apply configuration changes while accepted work is active", async () => {
    const { runner } = await fixture(deterministicModels(400));
    try {
      const { bot, conversation } = await createChat(runner, "test-model");
      await runner.submit({
        conversationId: conversation.id,
        text: "等待回复",
        requestId: "busy-1",
      });
      await active(runner, conversation.id);
      await runner.updateBot(bot.id, { instructions: "新指令" }, bot.configVersion);
      await expect(runner.applyBotSettings(conversation.id)).rejects.toThrow("必须等它空闲");
      await reply(runner, conversation.id);
    } finally {
      await runner.close();
    }
  });

  it("archives without cancelling work or completing the work goal", async () => {
    const { runner } = await fixture(deterministicModels());
    try {
      const { bot, conversation } = await createChat(runner, "test-model");
      await runner.saveGoal(conversation.id, "完成项目");
      await runner.archiveBot(bot.id, bot.configVersion);
      await expect(runner.createConversation({ botId: bot.id, cwd: "", goal: "" })).rejects.toThrow(
        "已归档",
      );
      await runner.submit({
        conversationId: conversation.id,
        text: "问候",
        requestId: "archived-1",
      });
      expect((await reply(runner, conversation.id)).goal.status).toBe("open");
      await runner.setGoalStatus(conversation.id, "completed");
      expect((await runner.snapshot(conversation.id)).goal.status).toBe("completed");
    } finally {
      await runner.close();
    }
  });

  it("uses durable admission idempotency, withdraws queued input and aborts active work", async () => {
    const { runner } = await fixture(deterministicModels(60_000, true));
    try {
      const { conversation } = await createChat(runner, "test-model");
      const input = { conversationId: conversation.id, text: "当前工作", requestId: "current-1" };
      const first = await runner.submit(input);
      expect((await runner.submit(input)).id).toBe(first.id);
      await active(runner, conversation.id);
      const queued = await runner.submit({
        conversationId: conversation.id,
        text: "排队",
        requestId: "queued-1",
      });
      expect((await runner.abortSubmission(conversation.id, queued.id)).status).toBe("aborted");
      await runner.abort(conversation.id);
      expect((await runner.snapshot(conversation.id)).activeTasks).toEqual([]);
    } finally {
      await runner.close();
    }
  });

  it("resumes accepted work after close without resubmitting the input", async () => {
    const { runner, dataDir } = await fixture(deterministicModels(60_000, true));
    const { conversation } = await createChat(runner, "test-model");
    await runner.submit({
      conversationId: conversation.id,
      text: "重启后继续",
      requestId: "resume-1",
    });
    await active(runner, conversation.id);
    await runner.close();
    const reopened = await openRunner({ dataDir, models: deterministicModels() });
    try {
      const snapshot = await reply(reopened, conversation.id);
      expect(
        snapshot.messages.filter(
          (message) => message.role === "user" && message.text === "重启后继续",
        ),
      ).toHaveLength(1);
      expect(snapshot.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    } finally {
      await reopened.close();
    }
  });

  it("keeps model credentials out of the tool process environment", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-secret";
    const { runner } = await fixture();
    try {
      expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
      expect((await runner.initialize()).apiKeyConfigured).toBe(true);
      expect(runner.setProviderCredential(null)).toEqual({ configured: false });
    } finally {
      await runner.close();
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });

  it("validates model and capability references before publishing or saving configuration", async () => {
    const { runner, dataDir } = await fixture();
    try {
      const { bot } = await createChat(runner);
      const path = "bots/" + bot.id + "/bot.json";
      const file = await runner.readConfiguration(path);
      const raw = JSON.parse(file.content);
      raw.agent.tools = ["unregistered-tool"];
      await expect(
        runner.saveConfiguration(path, file.version, JSON.stringify(raw)),
      ).rejects.toThrow("模型或能力");
      expect((await runner.readConfiguration(path)).content).toBe(file.content);
      raw.agent.model.modelId = "unavailable-model";
      await writeFile(join(dataDir, path), JSON.stringify(raw));
      const reloaded = await runner.reloadConfiguration();
      expect(reloaded.bots[0]?.configVersion).toBe(bot.configVersion);
      expect(reloaded.configuration.errors).toContainEqual(
        expect.objectContaining({ botId: bot.id }),
      );
      await expect(runner.createConversation({ botId: bot.id, cwd: "", goal: "" })).rejects.toThrow(
        "配置缺失或无效",
      );
    } finally {
      await runner.close();
    }
  });

  it("allows a cold-invalid Runner config to be repaired through the protocol operations", async () => {
    const { runner, dataDir } = await fixture();
    await runner.close();
    await writeFile(join(dataDir, "runner.json"), "{");
    const diagnostic = await openRunner({ dataDir });
    try {
      expect((await diagnostic.initialize()).configuration.ready).toBe(false);
      const broken = await diagnostic.readConfiguration("runner.json");
      await diagnostic.saveConfiguration(
        "runner.json",
        broken.version,
        JSON.stringify({
          schemaVersion: 1,
          name: "修复后的 Runner",
          workspace: { root: "workspaces" },
          providers: { deepseek: { type: "deepseek", credentialRef: "provider/deepseek" } },
          botDefaults: {
            model: { provider: "deepseek", modelId: "deepseek-chat" },
            thinkingLevel: "medium",
            instructions: "",
            extensions: ["coding-tools"],
            tools: ["read"],
          },
          harness: {},
        }),
      );
      expect((await diagnostic.initialize()).configuration.ready).toBe(true);
    } finally {
      await diagnostic.close();
    }
  });
});
