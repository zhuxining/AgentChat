import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ConfigurationFiles, diagnostic, digest } from "./files.js";
import {
  ConfigurationFailure,
  defaultRunnerConfiguration,
  parseBot,
  parseJSON,
  parseRunner,
  safeBotId,
  type Bot,
  type BotConfiguration,
  type ConfigurationError,
  type ConfigurationFile,
  type ResolvedBot,
  type RunnerConfiguration,
} from "./schema.js";
export type {
  AgentConfiguration,
  Bot,
  BotConfiguration,
  ConfigurationError,
  ConfigurationFile,
  ResolvedBot,
  RunnerConfiguration,
  ThinkingLevel,
} from "./schema.js";

type AgentChoices = Pick<
  Bot,
  "model" | "thinkingLevel" | "instructions" | "cwd" | "extensions" | "tools"
>;
type ValidateAgent = (agent: AgentChoices) => void;
const initializedPath = ".configuration-initialized";
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
type Snapshot = { raw: BotConfiguration; resolved: ResolvedBot };
type Bundle = ConfigurationFile & {
  raw?: BotConfiguration;
  instructions?: string;
  instructionError?: unknown;
  instructionPath?: string;
};

/** JSON files own desired configuration; snapshots are only the last validated values. */
export class Configuration {
  readonly dataDir: string;
  private readonly files: ConfigurationFiles;
  private activeRunner: RunnerConfiguration | undefined;
  private diagnostics: ConfigurationError[] = [];
  private snapshots = new Map<string, Snapshot>();
  private unavailable = new Set<string>();
  private runnerInvalid = false;
  private editablePaths: string[] = ["runner.json"];
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    dataDir: string,
    private readonly validateAgent?: ValidateAgent,
    private readonly onRunnerParsed?: (runner: RunnerConfiguration) => void,
  ) {
    this.dataDir = dataDir;
    this.files = new ConfigurationFiles(dataDir);
  }

  static async open(
    dataDir: string,
    validateAgent?: ValidateAgent,
    onRunnerParsed?: (runner: RunnerConfiguration) => void,
  ): Promise<Configuration> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const configuration = new Configuration(await realpath(dataDir), validateAgent, onRunnerParsed);
    await configuration.initialize();
    await configuration.reload();
    return configuration;
  }

  beforeRunnerSave?: (runner: RunnerConfiguration) => Promise<void>;

  get runner(): RunnerConfiguration | undefined {
    return this.activeRunner && structuredClone(this.activeRunner);
  }
  get ready(): boolean {
    return !this.runnerInvalid && this.activeRunner !== undefined;
  }
  paths(): string[] {
    return [...this.editablePaths];
  }
  get errors(): ConfigurationError[] {
    return structuredClone(this.diagnostics);
  }
  bots(): ResolvedBot[] {
    return [...this.snapshots.values()].map(({ resolved }) => structuredClone(resolved));
  }

  requireBot(id: string): ResolvedBot {
    safeBotId(id);
    if (this.runnerInvalid || !this.activeRunner)
      throw new ConfigurationFailure("Runner 配置无效，不能创建执行");
    const bot = this.snapshots.get(id)?.resolved;
    if (!bot || this.unavailable.has(id)) throw new ConfigurationFailure("Bot 配置缺失或无效");
    if (bot.archived) throw new ConfigurationFailure("Bot 不存在或已归档");
    if (!Object.hasOwn(this.activeRunner.providers, bot.model.provider))
      throw new ConfigurationFailure("Bot 引用了不可用的 Provider");
    return structuredClone(bot);
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async initialize(): Promise<void> {
    // Mark before initializing. Once a root has been seen, removing runner.json is an error.
    // An existing file (including an invalid one) is always left intact.
    const seen = await this.files.exists(initializedPath);
    let hasRunner = true;
    try {
      hasRunner = await this.files.exists("runner.json");
    } catch {
      /* An unreadable or symlinked existing file must never be initialized over. */
    }
    if (!seen) {
      await this.files.write(initializedPath, "1\n", async () => undefined);
      if (!hasRunner)
        await this.files.write("runner.json", encode(defaultRunnerConfiguration()), async () => {
          if (await this.files.exists("runner.json"))
            throw new ConfigurationFailure("配置已被其他进程创建");
        });
    }
    // A bad bots path should be a reload diagnostic, not prevent UI connection.
    try {
      await this.files.ensureDirectory("bots");
    } catch {
      /* reload records this diagnostic. */
    }
  }

  reload(): Promise<void> {
    return this.serial(() => this.load());
  }

  private async load(): Promise<void> {
    const errors: ConfigurationError[] = [];
    try {
      this.activeRunner = this.resolveRunner((await this.files.read("runner.json")).content);
      this.runnerInvalid = false;
    } catch (error) {
      this.runnerInvalid = true;
      errors.push({ path: "runner.json", message: diagnostic(error) });
    }
    let ids: string[] = [];
    try {
      ids = await this.files.listBots();
    } catch (error) {
      errors.push({ path: "bots", message: diagnostic(error) });
    }
    const found = new Set(ids);
    const unavailable = new Set<string>();
    const editablePaths = new Set(["runner.json"]);
    for (const id of ids) {
      const path = `bots/${id}/bot.json`;
      try {
        safeBotId(id);
        editablePaths.add(path);
        const bundle = await this.bundle(id);
        if (bundle.instructionPath) editablePaths.add(bundle.instructionPath);
        const snapshot = this.projectBot(id, bundle);
        this.snapshots.set(id, snapshot);
      } catch (error) {
        unavailable.add(id);
        errors.push({ path, botId: id, message: diagnostic(error) });
      }
    }
    for (const id of this.snapshots.keys()) {
      if (!found.has(id)) {
        unavailable.add(id);
        errors.push({ path: `bots/${id}/bot.json`, botId: id, message: "Bot 配置缺失" });
      }
    }
    this.editablePaths = [...editablePaths];
    this.unavailable = unavailable;
    this.diagnostics = errors;
  }

  private validate(choices: AgentChoices): void {
    try {
      this.validateAgent?.(choices);
    } catch {
      throw new ConfigurationFailure("配置引用的模型或能力当前不可用");
    }
  }

  private resolveRunner(content: string): RunnerConfiguration {
    const runner = parseRunner(parseJSON(content));
    this.onRunnerParsed?.(runner);
    this.validate({ ...runner.botDefaults, cwd: resolve(this.dataDir, runner.workspace.root) });
    return runner;
  }

  private instructionPath(id: string, configured: string): string {
    // Deliberately only bot-local files: no implicit workspaces or parent-directory search.
    const path = `bots/${safeBotId(id)}/${configured}`;
    this.files.path(path);
    if (isAbsolute(configured) || configured.includes("\\"))
      throw new ConfigurationFailure("指令文件路径无效");
    return path;
  }

  private async bundle(id: string, overrides = new Map<string, string>()): Promise<Bundle> {
    const path = `bots/${safeBotId(id)}/bot.json`;
    const read = async (filePath: string) => {
      const content = overrides.get(filePath);
      return content === undefined
        ? this.files.read(filePath)
        : { content, version: digest(content) };
    };
    const file = await read(path);
    let raw: BotConfiguration | undefined;
    let configuredInstruction: string | undefined;
    try {
      const parsed = parseJSON(file.content);
      // Even a schema-invalid Bot can reference a repairable instruction file.
      if (parsed && typeof parsed === "object" && "agent" in parsed) {
        const agent = parsed.agent;
        if (
          agent &&
          typeof agent === "object" &&
          "instructionsFile" in agent &&
          typeof agent.instructionsFile === "string"
        )
          configuredInstruction = agent.instructionsFile;
      }
      raw = parseBot(parsed);
    } catch {
      // Keep the raw text readable so a cold-start invalid file can be repaired.
    }
    let instructions = raw?.agent.instructions;
    let instructionVersion: string | undefined;
    let instructionError: unknown;
    let instructionPath: string | undefined;
    if (configuredInstruction !== undefined) {
      try {
        instructionPath = this.instructionPath(id, configuredInstruction);
        const instruction = await read(instructionPath);
        instructions = instruction.content;
        instructionVersion = instruction.version;
      } catch (error) {
        instructionError = error;
        instructionVersion = `error:${diagnostic(error)}`;
      }
    }
    return {
      path,
      content: file.content,
      version: digest(JSON.stringify([file.version, instructionVersion ?? null])),
      raw,
      instructions,
      instructionError,
      instructionPath,
    };
  }

  private async resolveBot(id: string, overrides?: Map<string, string>): Promise<Snapshot> {
    return this.projectBot(id, await this.bundle(id, overrides));
  }

  private projectBot(id: string, bundle: Bundle): Snapshot {
    const raw = bundle.raw ?? parseBot(parseJSON(bundle.content));
    if (bundle.instructionError) throw bundle.instructionError;
    if (this.activeRunner && !Object.hasOwn(this.activeRunner.providers, raw.agent.model.provider))
      throw new ConfigurationFailure("Bot 引用了不可用的 Provider");
    const resolved: ResolvedBot = {
      id,
      name: raw.name,
      archived: raw.archived,
      model: raw.agent.model,
      thinkingLevel: raw.agent.thinkingLevel,
      instructions: bundle.instructions ?? "",
      extensions: raw.agent.extensions,
      tools: raw.agent.tools,
      cwd: resolve(this.dataDir, raw.workspace.path),
      configVersion: bundle.version,
    };
    this.validate(resolved);
    return { raw, resolved };
  }

  async createBot(draft: Partial<Bot> & { name: string }): Promise<ResolvedBot> {
    return this.serial(async () => {
      if (!this.activeRunner || this.runnerInvalid)
        throw new ConfigurationFailure("Runner 配置无效，不能创建 Bot");
      const id = safeBotId(draft.id ?? randomUUID());
      const defaults = this.activeRunner.botDefaults;
      const cwd = draft.cwd || join(this.activeRunner.workspace.root, id);
      const raw: BotConfiguration = parseBot({
        schemaVersion: 1,
        name: draft.name,
        archived: draft.archived ?? false,
        workspace: { path: cwd },
        agent: {
          model: draft.model ?? defaults.model,
          thinkingLevel: draft.thinkingLevel ?? defaults.thinkingLevel,
          instructions: draft.instructions ?? defaults.instructions,
          extensions: draft.extensions ?? defaults.extensions,
          tools: draft.tools ?? defaults.tools,
        },
      });
      const path = `bots/${id}/bot.json`;
      if (await this.files.exists(path)) throw new ConfigurationFailure("Bot 配置已存在");
      const content = encode(raw);
      await this.resolveBot(id, new Map([[path, content]]));
      await this.files.ensureDirectory(`bots/${id}`);
      // Only allocate automatic workspaces; explicit external projects must not be created here.
      if (!draft.cwd) {
        const workspace = resolve(this.dataDir, cwd);
        const local = relative(this.dataDir, workspace);
        if (!local.startsWith("..") && !isAbsolute(local) && local)
          await this.files.ensureDirectory(local.split("\\").join("/"));
        else await mkdir(workspace, { recursive: true, mode: 0o700 });
      }
      await this.files.write(path, content, async () => {
        if (await this.files.exists(path)) throw new ConfigurationFailure("Bot 配置已存在");
      });
      await this.load();
      const result = this.snapshots.get(id)?.resolved;
      if (!result || this.unavailable.has(id)) throw new ConfigurationFailure("Bot 保存后校验失败");
      return structuredClone(result);
    });
  }

  async updateBot(bot: Bot, expectedVersion: string): Promise<ResolvedBot> {
    return this.serial(async () => {
      safeBotId(bot.id);
      this.expectVersion(expectedVersion);
      const bundle = await this.bundle(bot.id);
      if (bundle.version !== expectedVersion)
        throw new ConfigurationFailure("配置已被修改，请刷新后重试");
      const old = this.snapshots.get(bot.id);
      const useFile =
        bundle.raw?.agent.instructionsFile !== undefined &&
        old?.resolved.instructions === bot.instructions;
      const raw = parseBot({
        schemaVersion: 1,
        name: bot.name,
        archived: bot.archived,
        workspace: { path: bot.cwd },
        agent: {
          model: bot.model,
          thinkingLevel: bot.thinkingLevel,
          ...(useFile
            ? { instructionsFile: bundle.raw?.agent.instructionsFile }
            : { instructions: bot.instructions }),
          extensions: bot.extensions,
          tools: bot.tools,
        },
      });
      await this.save(bundle.path, expectedVersion, encode(raw));
      const result = this.snapshots.get(bot.id)?.resolved;
      if (!result || this.unavailable.has(bot.id))
        throw new ConfigurationFailure("Bot 保存后校验失败");
      return structuredClone(result);
    });
  }

  async archiveBot(id: string, expectedVersion: string): Promise<ResolvedBot> {
    const bot = this.snapshots.get(safeBotId(id))?.resolved;
    if (!bot) throw new ConfigurationFailure("Bot 配置缺失或无效");
    return this.updateBot({ ...bot, archived: true }, expectedVersion);
  }

  private expectVersion(version: string): void {
    if (typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version))
      throw new ConfigurationFailure("保存配置必须提供有效版本");
  }

  private async permitted(path: string): Promise<{ botId?: string; instruction: boolean }> {
    this.files.path(path);
    if (path === "runner.json") return { instruction: false };
    const match = /^bots\/([^/]+)\/(.+)$/.exec(path);
    if (!match?.[1]) throw new ConfigurationFailure("不允许访问此配置路径");
    const id = safeBotId(match[1]);
    if (match[2] === "bot.json") return { botId: id, instruction: false };
    const bundle = await this.bundle(id);
    if (path !== bundle.instructionPath) throw new ConfigurationFailure("不允许访问此配置路径");
    return { botId: id, instruction: true };
  }

  async readConfiguration(path: string): Promise<ConfigurationFile> {
    const target = await this.permitted(path);
    try {
      if (target.botId && !target.instruction) {
        const bundle = await this.bundle(target.botId);
        return { path, content: bundle.content, version: bundle.version };
      }
      return { path, ...(await this.files.read(path)) };
    } catch (error) {
      throw new ConfigurationFailure(diagnostic(error));
    }
  }

  saveConfiguration(path: string, expectedVersion: string, content: string): Promise<void> {
    return this.serial(() => this.save(path, expectedVersion, content));
  }

  private async save(path: string, expectedVersion: string, content: string): Promise<void> {
    this.expectVersion(expectedVersion);
    const target = await this.permitted(path);
    if (typeof content !== "string") throw new ConfigurationFailure("配置内容无效");
    const overrides = new Map([[path, content]]);
    if (target.botId) await this.resolveBot(target.botId, overrides);
    else {
      const runner = this.resolveRunner(content);
      await this.beforeRunnerSave?.(runner);
    }
    try {
      await this.files.write(path, content, async () => {
        const current = await this.readConfiguration(path);
        if (current.version !== expectedVersion)
          throw new ConfigurationFailure("配置已被修改，请刷新后重试");
      });
    } catch (error) {
      throw new ConfigurationFailure(diagnostic(error));
    }
    await this.load();
  }
}
