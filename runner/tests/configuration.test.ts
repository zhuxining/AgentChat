import { execFileSync } from "node:child_process";
import { open } from "node:fs/promises";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { Configuration, type BotConfiguration } from "../src/config/configuration.js";
import { MAX_CONFIG_BYTES } from "../src/config/files.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => {
      await chmod(path, 0o700).catch(() => undefined);
      await rm(path, { recursive: true, force: true });
    }),
  );
});
async function fixture() {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), "agentchat-configuration-")));
  directories.push(dataDir);
  return { dataDir, configuration: await Configuration.open(dataDir) };
}
async function editBot(dataDir: string, id: string, edit: (raw: BotConfiguration) => void) {
  const path = join(dataDir, "bots", id, "bot.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as BotConfiguration;
  edit(raw);
  await writeFile(path, JSON.stringify(raw));
}
async function editRunner(
  configuration: Configuration,
  edit: (raw: NonNullable<Configuration["runner"]>) => void,
) {
  const file = await configuration.readConfiguration("runner.json");
  const raw = JSON.parse(file.content) as NonNullable<Configuration["runner"]>;
  edit(raw);
  await configuration.saveConfiguration(file.path, file.version, JSON.stringify(raw));
}

describe("file-backed Runner configuration", () => {
  it("initializes schema 1 and materializes stable Bot defaults and a per-Bot workspace", async () => {
    const { dataDir, configuration } = await fixture();
    expect(configuration.errors).toEqual([]);
    expect(configuration.runner?.harness).toEqual({});
    const bot = await configuration.createBot({ name: "开发助手" });
    expect(bot).toEqual(
      expect.objectContaining({
        name: "开发助手",
        cwd: join(dataDir, "workspaces", bot.id),
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        instructions: "",
        tools: ["bash", "edit", "read", "write"],
        extensions: ["coding-tools"],
        archived: false,
      }),
    );
    const raw = JSON.parse(
      await readFile(join(dataDir, "bots", bot.id, "bot.json"), "utf8"),
    ) as BotConfiguration;
    expect(raw.workspace.path).toBe(join("workspaces", bot.id));
    expect(raw.agent.instructions).toBe("");
    expect(raw).not.toHaveProperty("id");
    await editRunner(configuration, (raw) => {
      raw.workspace.root = "other-workspaces";
      raw.botDefaults.instructions = "仅用于新 Bot";
      raw.botDefaults.tools = [];
    });
    expect(configuration.requireBot(bot.id)).toEqual(bot);
    const next = await configuration.createBot({ name: "新助手" });
    expect(next.cwd).toBe(join(dataDir, "other-workspaces", next.id));
    expect(next.instructions).toBe("仅用于新 Bot");
    expect(next.tools).toEqual([]);
    const reopened = await Configuration.open(dataDir);
    expect(reopened.requireBot(bot.id)).toEqual(bot);
  });

  it("reads external edits only at explicit reload and keeps previous returned snapshots immutable", async () => {
    const { dataDir, configuration } = await fixture();
    const bot = await configuration.createBot({ name: "原始名称" });
    await editBot(dataDir, bot.id, (raw) => {
      raw.name = "磁盘名称";
      raw.workspace.path = "project";
    });
    expect(configuration.requireBot(bot.id).name).toBe("原始名称");
    await configuration.reload();
    expect(configuration.requireBot(bot.id)).toEqual(
      expect.objectContaining({ name: "磁盘名称", cwd: join(dataDir, "project") }),
    );
    expect(bot.name).toBe("原始名称");
    expect(configuration.requireBot(bot.id).configVersion).not.toBe(bot.configVersion);
    const copied = configuration.bots();
    copied[0]!.name = "客户端修改";
    expect(configuration.requireBot(bot.id).name).toBe("磁盘名称");
  });

  it("retains last valid Runner settings and Bot display data but blocks new executions on invalid reload", async () => {
    const { dataDir, configuration } = await fixture();
    const good = await configuration.createBot({ name: "正常助手" });
    const broken = await configuration.createBot({ name: "待修改" });
    const initialRunner = configuration.runner;
    await writeFile(join(dataDir, "runner.json"), '{"secret-value-never-echo": "sensitive-token",');
    await configuration.reload();
    expect(configuration.runner).toEqual(initialRunner);
    expect(configuration.ready).toBe(false);
    expect(configuration.errors).toEqual([
      expect.objectContaining({ path: "runner.json", message: "配置 JSON 语法无效" }),
    ]);
    expect(() => configuration.requireBot(good.id)).toThrow("Runner 配置无效");
    expect(JSON.stringify(configuration.errors)).not.toContain("sensitive-token");
    await writeFile(join(dataDir, "runner.json"), JSON.stringify(initialRunner));
    await editBot(dataDir, broken.id, (raw) => {
      raw.agent.thinkingLevel = "unknown" as BotConfiguration["agent"]["thinkingLevel"];
    });
    await configuration.reload();
    expect(configuration.requireBot(good.id)).toEqual(good);
    expect(configuration.ready).toBe(true);
    expect(configuration.bots()).toContainEqual(broken);
    expect(() => configuration.requireBot(broken.id)).toThrow("Bot 配置缺失或无效");
    expect(configuration.errors).toEqual([expect.objectContaining({ botId: broken.id })]);
  });

  it("opens with invalid cold-start configuration so the client can repair it", async () => {
    const { dataDir, configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    await writeFile(join(dataDir, "runner.json"), "not JSON");
    await writeFile(join(dataDir, "bots", bot.id, "bot.json"), "not JSON");
    const reopened = await Configuration.open(dataDir);
    expect(reopened.runner).toBeUndefined();
    expect(reopened.bots()).toEqual([]);
    expect(reopened.errors).toHaveLength(2);
    const invalid = await reopened.readConfiguration("runner.json");
    expect(invalid.content).toBe("not JSON");
    await reopened.saveConfiguration(
      "runner.json",
      invalid.version,
      JSON.stringify(configuration.runner),
    );
    expect(reopened.runner).toEqual(configuration.runner);
    expect(await readFile(join(dataDir, "bots", bot.id, "bot.json"), "utf8")).toBe("not JSON");
  });

  it("snapshots bot-local instruction files and includes their bytes in stale-save protection", async () => {
    const { dataDir, configuration } = await fixture();
    const created = await configuration.createBot({ name: "助手" });
    const directory = join(dataDir, "bots", created.id);
    await writeFile(join(directory, "instructions.md"), "第一版\n");
    await editBot(dataDir, created.id, (raw) => {
      delete raw.agent.instructions;
      raw.agent.instructionsFile = "instructions.md";
    });
    await configuration.reload();
    const bot = configuration.requireBot(created.id);
    const jsonFile = await configuration.readConfiguration(`bots/${bot.id}/bot.json`);
    expect(bot.instructions).toBe("第一版\n");
    expect(jsonFile.version).toBe(bot.configVersion);
    await writeFile(join(directory, "instructions.md"), "第二版\n");
    expect(configuration.requireBot(bot.id).instructions).toBe("第一版\n");
    await expect(
      configuration.updateBot({ ...bot, name: "过期修改" }, bot.configVersion),
    ).rejects.toThrow("配置已被修改");
    await expect(
      configuration.saveConfiguration(jsonFile.path, jsonFile.version, jsonFile.content),
    ).rejects.toThrow("配置已被修改");
    await configuration.reload();
    const next = configuration.requireBot(bot.id);
    expect(next.instructions).toBe("第二版\n");
    expect(bot.instructions).toBe("第一版\n");
    const updated = await configuration.updateBot({ ...next, name: "新名称" }, next.configVersion);
    expect(updated.name).toBe("新名称");
    const raw = JSON.parse(
      (await configuration.readConfiguration(jsonFile.path)).content,
    ) as BotConfiguration;
    expect(raw.agent.instructionsFile).toBe("instructions.md");
    expect(raw.agent).not.toHaveProperty("instructions");
    const file = await configuration.readConfiguration(`bots/${bot.id}/instructions.md`);
    await configuration.saveConfiguration(file.path, file.version, "第三版\n");
    expect(configuration.requireBot(bot.id).instructions).toBe("第三版\n");
  });

  it("rejects stale Bot/Runner saves and requires a content version", async () => {
    const { dataDir, configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    await editBot(dataDir, bot.id, (raw) => {
      raw.name = "编辑器修改";
    });
    await expect(
      configuration.updateBot({ ...bot, name: "旧 UI" }, bot.configVersion),
    ).rejects.toThrow("配置已被修改");
    expect(
      (
        JSON.parse(
          await readFile(join(dataDir, "bots", bot.id, "bot.json"), "utf8"),
        ) as BotConfiguration
      ).name,
    ).toBe("编辑器修改");
    await expect(configuration.updateBot(bot, "")).rejects.toThrow("必须提供有效版本");
    const runner = await configuration.readConfiguration("runner.json");
    await writeFile(join(dataDir, "runner.json"), `${runner.content} `);
    await expect(
      configuration.saveConfiguration(runner.path, runner.version, runner.content),
    ).rejects.toThrow("配置已被修改");
  });

  it("marks deleted Bot configuration unavailable without deleting display history or workspace files", async () => {
    const { dataDir, configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    await writeFile(join(bot.cwd, "artifact.txt"), "保留");
    await rm(join(dataDir, "bots", bot.id, "bot.json"));
    await configuration.reload();
    expect(configuration.bots()).toContainEqual(bot);
    expect(configuration.errors).toContainEqual(expect.objectContaining({ botId: bot.id }));
    expect(() => configuration.requireBot(bot.id)).toThrow("Bot 配置缺失或无效");
    expect(await readFile(join(bot.cwd, "artifact.txt"), "utf8")).toBe("保留");
    await rm(join(dataDir, "runner.json"));
    await configuration.reload();
    expect(configuration.runner).toBeDefined();
    const reopened = await Configuration.open(dataDir);
    expect(reopened.runner).toBeUndefined();
    expect(reopened.errors).toContainEqual(expect.objectContaining({ path: "runner.json" }));
    await expect(readFile(join(dataDir, "runner.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lists cold-start invalid Bot files and safe referenced instructions, including missing files", async () => {
    const { dataDir, configuration } = await fixture();
    const bot = await configuration.createBot({ name: "原始名称" });
    await editBot(dataDir, bot.id, (raw) => {
      raw.name = "";
      delete raw.agent.instructions;
      raw.agent.instructionsFile = "missing-instructions.md";
    });
    await mkdir(join(dataDir, "bots", "invalid-json"));
    await writeFile(join(dataDir, "bots", "invalid-json", "bot.json"), "invalid JSON");
    const reopened = await Configuration.open(dataDir);
    expect(reopened.ready).toBe(true);
    expect(reopened.bots()).toEqual([]);
    expect(reopened.paths()).toEqual([
      "runner.json",
      `bots/${bot.id}/bot.json`,
      `bots/${bot.id}/missing-instructions.md`,
      "bots/invalid-json/bot.json",
    ]);
    expect((await reopened.readConfiguration(`bots/${bot.id}/bot.json`)).content).toContain(
      "missing-instructions.md",
    );
    await writeFile(join(dataDir, "bots", bot.id, "missing-instructions.md"), "可以修复");
    await reopened.reload();
    expect(
      (await reopened.readConfiguration(`bots/${bot.id}/missing-instructions.md`)).content,
    ).toBe("可以修复");
    await editBot(dataDir, bot.id, (raw) => {
      raw.agent.instructionsFile = "../outside.md";
    });
    await reopened.reload();
    expect(reopened.paths()).not.toContain(`bots/${bot.id}/../outside.md`);
  });

  it("archives with an explicit version and preserves the Bot configuration", async () => {
    const { configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    const archived = await configuration.archiveBot(bot.id, bot.configVersion);
    expect(archived.archived).toBe(true);
    expect(configuration.bots()).toContainEqual(archived);
    expect(() => configuration.requireBot(bot.id)).toThrow("已归档");
    await expect(configuration.archiveBot(bot.id, bot.configVersion)).rejects.toThrow(
      "配置已被修改",
    );
  });

  it.each([
    { unexpected: "must-not-be-echoed" },
    { schemaVersion: 2 },
    { harness: { stream: { headers: { authorization: "must-not-be-echoed" } } } },
    { harness: { retry: { maxRetries: -1 } } },
    { harness: { compaction: { reserveTokens: 1.5 } } },
    { harness: { stream: { timeoutMs: 0 } } },
    { providers: { alias: { type: "deepseek", credentialRef: "provider/deepseek" } } },
    { providers: { deepseek: { type: "deepseek", credentialRef: "wrong-reference" } } },
  ])("rejects unknown/unsupported Runner fields without changing the file: %j", async (patch) => {
    const { configuration } = await fixture();
    const before = await configuration.readConfiguration("runner.json");
    await expect(
      configuration.saveConfiguration(
        before.path,
        before.version,
        JSON.stringify({ ...configuration.runner, ...patch }),
      ),
    ).rejects.toThrow("配置");
    expect(await configuration.readConfiguration("runner.json")).toEqual(before);
  });

  it("maps supported Harness settings precisely and permits an unconfigured Provider catalog", async () => {
    const { configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    const harness = {
      toolExecution: "sequential" as const,
      followUpMode: "all" as const,
      steeringMode: "one-at-a-time" as const,
      stream: { timeoutMs: 1000, maxRetries: 0 },
      retry: { enabled: false, maxRetries: 3, baseDelayMs: 10 },
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50, backgroundTokens: 0 },
    };
    await editRunner(configuration, (raw) => {
      raw.harness = harness;
    });
    expect(configuration.runner?.harness).toEqual(harness);
    await editRunner(configuration, (raw) => {
      raw.providers = {};
    });
    expect(configuration.runner?.providers).toEqual({});
    expect(() => configuration.requireBot(bot.id)).toThrow("Bot 配置缺失或无效");
    await expect(configuration.createBot({ name: "缺 Provider" })).rejects.toThrow(
      "不可用的 Provider",
    );
  });

  it("rejects both instruction sources, duplicate selections, and unknown Bot fields", async () => {
    const { configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    const file = await configuration.readConfiguration(`bots/${bot.id}/bot.json`);
    const raw = JSON.parse(file.content) as BotConfiguration;
    await expect(
      configuration.saveConfiguration(
        file.path,
        file.version,
        JSON.stringify({ ...raw, unexpected: "secret" }),
      ),
    ).rejects.toThrow("未知字段");
    raw.agent.instructionsFile = "instructions.md";
    await expect(
      configuration.saveConfiguration(file.path, file.version, JSON.stringify(raw)),
    ).rejects.toThrow("instructions/instructionsFile");
    delete raw.agent.instructionsFile;
    raw.agent.tools = ["read", "read"];
    await expect(
      configuration.saveConfiguration(file.path, file.version, JSON.stringify(raw)),
    ).rejects.toThrow("agent.tools");
    expect(await configuration.readConfiguration(file.path)).toEqual(file);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a FIFO configuration without waiting for a writer",
    async () => {
      const { dataDir, configuration } = await fixture();
      const path = join(dataDir, "runner.json");
      await rm(path);
      execFileSync("mkfifo", [path]);
      const reading = configuration.readConfiguration("runner.json");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        reading.then(
          () => "accepted",
          () => "rejected",
        ),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("blocked"), 1000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      // Release the old blocking implementation so a regression fails without leaking a worker.
      if (outcome === "blocked") {
        const writer = await open(path, "w");
        await reading.catch(() => undefined);
        await writer.close();
      }
      expect(outcome).toBe("rejected");
    },
  );

  it("rejects traversal, symlinked configs and instruction files, and oversized files", async () => {
    const { dataDir, configuration } = await fixture();
    const bot = await configuration.createBot({ name: "助手" });
    for (const path of [
      "../runner.json",
      "/etc/passwd",
      "state/runner.sqlite",
      "bots/../runner.json",
    ]) {
      await expect(configuration.readConfiguration(path)).rejects.toThrow("配置路径");
    }
    await expect(configuration.createBot({ id: "../escape", name: "无效" })).rejects.toThrow(
      "botId",
    );
    await writeFile(join(dataDir, "outside.md"), "不可读取的外部内容");
    await editBot(dataDir, bot.id, (raw) => {
      delete raw.agent.instructions;
      raw.agent.instructionsFile = "../../outside.md";
    });
    await configuration.reload();
    expect(() => configuration.requireBot(bot.id)).toThrow("配置缺失或无效");
    expect(JSON.stringify(configuration.errors)).not.toContain("不可读取的外部内容");
    await editBot(dataDir, bot.id, (raw) => {
      raw.agent.instructionsFile = "instructions.md";
    });
    await symlink(join(dataDir, "outside.md"), join(dataDir, "bots", bot.id, "instructions.md"));
    await configuration.reload();
    expect(configuration.errors).toContainEqual(
      expect.objectContaining({ botId: bot.id, message: "配置路径不能包含符号链接" }),
    );
    await expect(configuration.readConfiguration(`bots/${bot.id}/instructions.md`)).rejects.toThrow(
      "符号链接",
    );
    await rm(join(dataDir, "bots", bot.id, "instructions.md"));
    await writeFile(
      join(dataDir, "bots", bot.id, "instructions.md"),
      "x".repeat(MAX_CONFIG_BYTES + 1),
    );
    await configuration.reload();
    expect(configuration.errors).toContainEqual(expect.objectContaining({ botId: bot.id }));
    await mkdir(join(dataDir, "external-bot"));
    await symlink(join(dataDir, "external-bot"), join(dataDir, "bots", "linked-bot"));
    await configuration.reload();
    expect(configuration.errors).toContainEqual(
      expect.objectContaining({ botId: "linked-bot", message: "配置路径不能包含符号链接" }),
    );
  });

  it("diagnoses a symlinked Runner file on cold start without following or replacing it", async () => {
    const { dataDir, configuration } = await fixture();
    await writeFile(join(dataDir, "outside.json"), JSON.stringify(configuration.runner));
    await rm(join(dataDir, "runner.json"));
    await symlink(join(dataDir, "outside.json"), join(dataDir, "runner.json"));
    const reopened = await Configuration.open(dataDir);
    expect(reopened.runner).toBeUndefined();
    expect(reopened.errors).toContainEqual({
      path: "runner.json",
      message: "配置路径不能包含符号链接",
    });
  });

  it("refuses writing a read-only config and leaves it intact", async () => {
    const { dataDir, configuration } = await fixture();
    const file = await configuration.readConfiguration("runner.json");
    await chmod(join(dataDir, "runner.json"), 0o400);
    try {
      await expect(
        configuration.saveConfiguration(file.path, file.version, file.content),
      ).rejects.toThrow("只读");
      expect(await configuration.readConfiguration(file.path)).toEqual(file);
    } finally {
      await chmod(join(dataDir, "runner.json"), 0o600);
    }
  });
});
