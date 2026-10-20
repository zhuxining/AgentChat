import { randomUUID } from "node:crypto";

import type { AuthPrompt } from "@earendil-works/pi-ai";

import type {
  ProviderInstance,
  ProviderLogin,
  ProviderReference,
  ProviderRequest,
  ProviderResponse,
  ProviderTestResult,
} from "../../../contracts/providers.js";
import type { NativeAdapter } from "../communication/native.js";
import type { Configuration, RunnerConfiguration } from "../config/configuration.js";
import { digest } from "../config/files.js";
import {
  builtins,
  createInstanceRuntime,
  instancesOf,
  modelViews,
  providerCatalog,
  validateEffective,
  type InstanceRuntime,
} from "./runtime.js";
import type { ProviderState } from "./state.js";

type LoginSession = {
  view: ProviderLogin;
  controller: AbortController;
  task: Promise<void>;
  answer?: (value: string) => void;
};
export class ProviderService {
  private readonly logins = new Map<string, LoginSession>();

  constructor(
    private readonly configuration: Configuration,
    private readonly native: NativeAdapter,
    private readonly activeSignature: () => string | undefined,
    private readonly references: () => Promise<ProviderReference[]>,
    private readonly legacyCredential?: () => string | undefined,
    private readonly state?: ProviderState,
  ) {}
  async version() {
    return digest(
      (await this.configuration.readConfiguration("runner.json")).version +
        (this.state?.credentialRevision ?? "0"),
    );
  }
  private instances() {
    return instancesOf(this.configuration.runner);
  }
  private requireInstance(id: string) {
    const item = this.instances().find((instance) => instance.id === id);
    if (!item) throw new Error("接入实例不存在");
    return item;
  }
  private runtime(instances = this.instances()) {
    return createInstanceRuntime(instances, this.native, {
      legacyCredential: this.legacyCredential,
      state: this.state,
    });
  }
  private async response(): Promise<ProviderResponse> {
    return {
      version: await this.version(),
      restartRequired:
        this.activeSignature() !== undefined &&
        this.activeSignature() !== JSON.stringify(this.configuration.runner?.providers),
    };
  }
  async validateChange(next: RunnerConfiguration): Promise<void> {
    const previous = this.instances();
    const desired = instancesOf(next);
    for (const instance of desired) validateEffective(instance);
    const refs = (await this.references()).filter((ref) => ref.kind !== "defaults");
    refs.push({
      kind: "defaults",
      id: "runner",
      modelId: next.botDefaults.model.modelId,
      provider: next.botDefaults.model.provider,
    } as ProviderReference & { provider: string });
    for (const old of previous) {
      const instance = desired.find((item) => item.id === old.id);
      const oldCustom = new Set(old.customModels.map((model) => model.id));
      const removed = old.customModels.filter(
        (model) => !instance?.customModels.some((item) => item.id === model.id),
      );
      const affected = refs.filter((ref) => ref.id !== "" && ref.modelId);
      // references() encodes instance in the internal field, stripped at the IPC boundary.
      const used = affected.filter(
        (ref) =>
          "provider" in ref &&
          ref.provider === old.id &&
          (!instance ||
            (removed.some((model) => model.id === ref.modelId) && oldCustom.has(ref.modelId))),
      );
      if (used.length)
        throw new Error("接入实例或自定义模型仍被 Bot 或持久会话引用，请先修改引用或停用实例");
      if (
        instance &&
        instance.type !== old.type &&
        refs.some((ref) => "provider" in ref && ref.provider === old.id)
      )
        throw new Error("已被引用的实例不能更换供应商类型");
    }
  }
  async request(raw: unknown): Promise<ProviderResponse> {
    const request = parseProviderRequest(raw);
    if (request.action === "list") {
      const result = await this.response();
      if (request.instanceId || request.type) {
        const instance = request.instanceId
          ? this.requireInstance(request.instanceId)
          : {
              id: "preview",
              name: "预览",
              type: request.type!,
              enabled: true,
              auth: { type: "ambient" as const },
              visibleModels: [],
              modelOverrides: {},
              customModels: [],
            };
        const supplier = request.instanceId
          ? this.runtime([instance]).catalogSuppliers.get(instance.id)
          : builtins().find((provider) => provider.id === instance.type);
        if (!supplier) throw new Error("供应商类型不存在");
        result.models = modelViews(instance, supplier).filter(
          (model) =>
            !request.search ||
            `${model.id} ${model.name}`.toLowerCase().includes(request.search.toLowerCase()),
        );
        if (request.instanceId)
          result.references = (await this.references())
            .filter((ref) => "provider" in ref && ref.provider === request.instanceId)
            .map(({ kind, id, modelId }) => ({ kind, id, modelId }));
      }
      result.catalog = providerCatalog();
      const selectedType =
        request.type ??
        (request.instanceId ? this.requireInstance(request.instanceId).type : undefined);
      const supplier = builtins().find((item) => item.id === selectedType);
      const entry = result.catalog.find((item) => item.type === selectedType);
      if (entry && supplier?.auth.apiKey) {
        const variables: string[] = [];
        let detected: string[] = [];
        let detectionError = false;
        const isCloudProvider = ["amazon-bedrock", "google-vertex"].includes(entry.type);
        try {
          // Probe with empty values so the public resolver reports every environment name it reads.
          await supplier.auth.apiKey.resolve({
            ctx: {
              env: async (name) => {
                variables.push(name);
                return undefined;
              },
              fileExists: async () => false,
            },
            signal: AbortSignal.timeout(2000),
          });
          const names = [...new Set(variables.filter((name) => /KEY|TOKEN/.test(name)))];
          detected = (
            await Promise.all(
              names.map(async (name) => ((await this.native.env(name)) ? name : undefined)),
            )
          ).filter((name): name is string => !!name);
        } catch {
          detectionError = true;
        }
        let configured: boolean | undefined;
        if (isCloudProvider) {
          try {
            configured = Boolean(
              await supplier.auth.apiKey.resolve({
                ctx: {
                  env: async (name) => (await this.native.env(name)) ?? undefined,
                  fileExists: (path) => this.native.fileExists(path),
                },
                signal: AbortSignal.timeout(2000),
              }),
            );
          } catch {
            detectionError = true;
          }
        }
        entry.environment = {
          variables: [...new Set(variables.filter((name) => /KEY|TOKEN/.test(name)))],
          detected,
          ...(configured === undefined ? {} : { configured }),
          ...(detectionError ? { detectionError: true } : {}),
        };
      }
      const runtime = this.runtime();
      result.instances = await Promise.all(
        this.instances().map(async (instance) => {
          if (!instance.enabled)
            return { instance, configured: false, status: "disabled" as const };
          try {
            const configured = Boolean(await runtime.models.checkAuth(instance.id));
            return {
              instance,
              configured,
              status: configured ? ("configured" as const) : ("missing" as const),
              ...(configured ? {} : { message: "所选凭据来源尚未配置或认证参数不完整" }),
            };
          } catch {
            return {
              instance,
              configured: false,
              status: "error" as const,
              message: "所选凭据来源读取失败，请检查来源及权限",
            };
          }
        }),
      );
      return result;
    }
    if (request.action === "save" || request.action === "remove") {
      if (request.expectedVersion !== (await this.version()))
        throw new Error("配置已被修改，请刷新后重试");
      const runner = this.configuration.runner;
      if (!runner) throw new Error("Runner 配置无效");
      const instances = this.instances();
      if (request.action === "save") {
        const instance = validateEffective(request.instance);
        const index = instances.findIndex((item) => item.id === instance.id);
        if (index < 0) instances.push(instance);
        else instances[index] = instance;
      } else {
        const index = instances.findIndex((item) => item.id === request.instanceId);
        if (index < 0) throw new Error("接入实例不存在");
        instances.splice(index, 1);
      }
      const next = {
        ...runner,
        schemaVersion: 2 as const,
        providers: Object.fromEntries(instances.map((instance) => [instance.id, instance])),
      };
      await this.configuration.saveConfiguration(
        "runner.json",
        (await this.configuration.readConfiguration("runner.json")).version,
        JSON.stringify(next, null, 2) + "\n",
      );
      return { ...(await this.response()), saved: true };
    }
    if (
      request.action === "loginStatus" ||
      request.action === "loginRespond" ||
      request.action === "cancelLogin"
    ) {
      const session = this.logins.get(request.loginId);
      if (!session) throw new Error("登录流程不存在");
      if (request.action === "loginRespond") {
        if (!session.answer || session.view.status !== "pending")
          throw new Error("登录流程当前不等待输入");
        if (
          session.view.prompt?.type === "select" &&
          !session.view.prompt.options?.some((option) => option.id === request.value)
        )
          throw new Error("登录选择无效");
        session.answer(request.value);
      }
      if (request.action === "cancelLogin") {
        session.controller.abort();
        await session.task;
      }
      return { ...(await this.response()), login: structuredClone(session.view) };
    }
    const instance = this.requireInstance(request.instanceId);
    const runtime = this.runtime([instance]);
    switch (request.action) {
      case "writeCredential": {
        if (!request.value.trim() || request.value.length > 8000) throw new Error("密钥值无效");
        if (instance.auth.type !== "apiKey") throw new Error("当前认证方式不接受 API Key");
        await runtime.credentials.modify(instance.id, async () => ({
          type: "api_key",
          key: request.value,
        }));
        return { ...(await this.response()), saved: true };
      }
      case "deleteCredential":
      case "logout":
        for (const session of this.logins.values())
          if (session.view.instanceId === instance.id && session.view.status === "pending") {
            session.controller.abort();
            await session.task;
          }
        await runtime.credentials.delete(instance.id);
        return { ...(await this.response()), saved: true };
      case "login": {
        if (instance.auth.type !== "oauth") throw new Error("请选择 OAuth 认证方式");
        for (const session of this.logins.values())
          if (session.view.instanceId === instance.id && session.view.status === "pending")
            return { ...(await this.response()), login: structuredClone(session.view) };
        const id = randomUUID();
        const controller = new AbortController();
        const view: ProviderLogin = { id, instanceId: instance.id, status: "pending" };
        const session: LoginSession = { view, controller, task: Promise.resolve() };
        this.logins.set(id, session);
        session.task = runtime.models
          .login(
            instance.id,
            "oauth",
            {
              signal: controller.signal,
              prompt: (prompt) => this.prompt(session, prompt),
              notify(event) {
                if (event.type === "auth_url") {
                  view.url = event.url;
                  view.instructions = event.instructions;
                } else if (event.type === "device_code") {
                  view.url = event.verificationUri;
                  view.instructions = event.userCode;
                } else {
                  view.progress = event.message;
                }
              },
            },
            { agentName: "AgentChat" },
          )
          .then(
            () => {
              view.status = "success";
              delete view.prompt;
              delete session.answer;
            },
            () => {
              view.status = controller.signal.aborted ? "cancelled" : "error";
              view.error = controller.signal.aborted ? undefined : "登录或凭据持久化失败，请重试";
              delete view.prompt;
              delete session.answer;
            },
          );
        return { ...(await this.response()), login: structuredClone(view) };
      }
      case "refreshModels": {
        const result = await runtime.models.refresh({
          providers: [instance.id],
          allowNetwork: true,
          force: true,
        });
        if (result.errors.size) throw new Error("模型目录刷新失败，请检查认证与网络");
        const supplier = runtime.catalogSuppliers.get(instance.id)!;
        return { ...(await this.response()), models: modelViews(instance, supplier) };
      }
      case "test":
        return this.test(request, instance, runtime);
    }
  }
  private prompt(session: LoginSession, prompt: AuthPrompt): Promise<string> {
    const signals = [session.controller.signal, ...(prompt.signal ? [prompt.signal] : [])];
    const signal = AbortSignal.any(signals);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        delete session.answer;
        delete session.view.prompt;
      };
      const abort = () => {
        cleanup();
        reject(new Error("登录已取消"));
      };
      session.view.prompt = {
        type: prompt.type,
        message: prompt.message,
        ...("placeholder" in prompt ? { placeholder: prompt.placeholder } : {}),
        ...(prompt.type === "select"
          ? { options: prompt.options.map((option) => ({ ...option })) }
          : {}),
      };
      session.answer = (value) => {
        cleanup();
        resolve(value);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  private async test(
    request: Extract<ProviderRequest, { action: "test" }>,
    instance: ProviderInstance,
    runtime: InstanceRuntime,
  ): Promise<ProviderResponse> {
    const version = await this.version();
    if (version !== request.expectedVersion) throw new Error("配置已被修改，请刷新后重试");
    const result: ProviderTestResult = {
      instanceId: instance.id,
      modelId: request.modelId,
      version,
      testedAt: new Date().toISOString(),
      success: false,
      message: "连接测试失败",
    };
    try {
      if (!instance.enabled) throw new Error("模型不可用");
      const model = runtime.models.getModel(instance.id, request.modelId);
      if (!model) {
        result.category = "model";
        throw new Error("模型不可用");
      }
      try {
        if (!(await runtime.models.checkAuth(instance.id))) throw new Error("凭据缺失");
      } catch {
        result.category = "credential";
        throw new Error("来源不可用");
      }
      const message = await runtime.models.completeSimple(
        model,
        { messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }] },
        { maxTokens: 16, maxRetries: 0, timeoutMs: 20_000, signal: AbortSignal.timeout(25_000) },
      );
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        const error = message.errorMessage ?? "";
        result.category = /401|403|unauthor|authenticat/i.test(error)
          ? "authentication"
          : /fetch|network|timeout|connect|ENOTFOUND/i.test(error)
            ? "network"
            : /model|404/i.test(error)
              ? "model"
              : "protocol";
      } else {
        result.success = true;
        result.message = "所选版本及模型连接测试成功";
      }
    } catch {
      result.category ??= "protocol";
    }
    if (!result.success)
      result.message = {
        credential: "凭据来源缺失、读取失败或认证参数不完整",
        authentication: "供应商拒绝认证",
        network: "网络连接失败或超时",
        protocol: "供应商响应无效或请求失败",
        model: "所选模型不存在或实例已停用",
      }[result.category ?? "protocol"];
    return { ...(await this.response()), test: result };
  }
  async close(): Promise<void> {
    for (const session of this.logins.values()) session.controller.abort();
    await Promise.allSettled([...this.logins.values()].map((session) => session.task));
  }
}
function parseProviderRequest(value: unknown): ProviderRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("供应商请求无效");
  const input = value as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    list: ["instanceId", "type", "search"],
    save: ["expectedVersion", "instance"],
    remove: ["expectedVersion", "instanceId"],
    test: ["expectedVersion", "instanceId", "modelId"],
    writeCredential: ["instanceId", "value"],
    deleteCredential: ["instanceId"],
    login: ["instanceId"],
    loginStatus: ["loginId"],
    loginRespond: ["loginId", "value"],
    cancelLogin: ["loginId"],
    logout: ["instanceId"],
    refreshModels: ["instanceId"],
  };
  if (typeof input.action !== "string" || !Object.hasOwn(fields, input.action))
    throw new Error("供应商操作无效");
  const allowed = fields[input.action]!;
  if (Object.keys(input).some((field) => field !== "action" && !allowed.includes(field)))
    throw new Error("供应商请求含未知字段");
  for (const field of allowed) {
    if (input.action === "list" && input[field] === undefined) continue;
    if (field === "instance") {
      validateEffective(input.instance as ProviderInstance);
      continue;
    }
    if (
      typeof input[field] !== "string" ||
      (input[field] as string).length > (field === "value" ? 16000 : 2000) ||
      (field !== "value" && !(input[field] as string).trim())
    )
      throw new Error("供应商请求字段无效");
  }
  return input as ProviderRequest; // All discriminated action fields validated above.
}
