import { randomUUID } from "node:crypto";

import {
  lazyStream,
  type AuthContext,
  type AuthResult,
  type Credential,
  type CredentialStore,
  type Api,
  type Model,
  type Provider,
  type ProviderAuth,
} from "@earendil-works/pi-ai";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { radiusProvider } from "@earendil-works/pi-ai/providers/radius";

import type {
  Json,
  ProviderCatalogEntry,
  ProviderInstance,
  ProviderModel,
} from "../../../contracts/providers.js";
import type { NativeAdapter } from "../communication/native.js";
import type { RunnerConfiguration } from "../config/schema.js";
import { chatApis } from "./apis.js";
import { ambientProviders, legacyInstance, parseChatModel, parseInstance } from "./schema.js";
import type { ProviderState } from "./state.js";

export function instancesOf(runner: RunnerConfiguration | undefined): ProviderInstance[] {
  return Object.entries(runner?.providers ?? {}).map(([id, value]) =>
    "credentialRef" in value ? { ...legacyInstance(), id } : structuredClone(value),
  );
}
export function mergeModel(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
  const result: Record<string, unknown> =
    base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("模型配置字段无效");
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeModel(result[key], value)
        : structuredClone(value);
  }
  return result;
}
export function builtins(): Provider[] {
  return builtinProviders().map((provider) => {
    if (provider.id !== "deepseek") return provider;
    const reference = provider.getModels()[0];
    if (!reference) return provider;
    const models = [...provider.getModels()];
    for (const id of ["deepseek-chat", "deepseek-reasoner"])
      if (!models.some((model) => model.id === id))
        models.push({
          ...reference,
          id,
          name: id,
          input: ["text"],
          reasoning: id === "deepseek-reasoner",
          thinkingLevelMap: undefined,
          contextWindow: 64_000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        });
    return { ...provider, getModels: () => models, getAllModels: () => models };
  });
}
export function providerCatalog(): ProviderCatalogEntry[] {
  return builtins().map((provider) => ({
    type: provider.id,
    name: provider.name,
    authentication: [
      ...(provider.auth.apiKey ? ["apiKey" as const] : []),
      ...(provider.auth.oauth ? ["oauth" as const] : []),
      ...(ambientProviders.has(provider.id) ? ["ambient" as const] : []),
    ],
    apis: Object.keys(chatApis),
    modelCount: provider.getModels().length,
  }));
}
export function effectiveModels(instance: ProviderInstance, supplier: Provider): Model<Api>[] {
  const models = new Map<string, Model<Api>>();
  for (const original of supplier.getModels()) {
    // JSON removes optional undefined fields; no runtime callbacks enter serialized Model<Api> data.
    const base: unknown = JSON.parse(
      JSON.stringify({
        ...original,
        provider: instance.id,
        ...(instance.baseUrl ? { baseUrl: instance.baseUrl } : {}),
        headers: { ...original.headers, ...instance.headers },
      }),
    );
    const patch = instance.modelOverrides[original.id];
    models.set(original.id, parseChatModel(patch ? mergeModel(base, patch) : base));
  }
  for (const custom of instance.customModels) {
    const merged = {
      ...custom,
      ...(instance.baseUrl && !custom.baseUrl ? { baseUrl: instance.baseUrl } : {}),
      headers: {
        ...instance.headers,
        ...(custom.headers && typeof custom.headers === "object" && !Array.isArray(custom.headers)
          ? (custom.headers as Record<string, string>)
          : {}),
      },
    };
    const parsed = parseChatModel(merged);
    models.set(parsed.id, parsed);
  }
  return [...models.values()];
}
export function modelViews(instance: ProviderInstance, supplier: Provider): ProviderModel[] {
  const defaults = new Map(
    effectiveModels({ ...instance, modelOverrides: {}, customModels: [] }, supplier).map(
      (model) => [model.id, model],
    ),
  );
  return effectiveModels(instance, supplier).map((model) => ({
    id: model.id,
    name: model.name,
    custom: instance.customModels.some((item) => item.id === model.id),
    overridden: Object.hasOwn(instance.modelOverrides, model.id),
    visible: instance.visibleModels.includes(model.id),
    definition: JSON.parse(JSON.stringify(model)) as { [key: string]: Json },
    ...(defaults.has(model.id) && !instance.customModels.some((item) => item.id === model.id)
      ? { defaults: JSON.parse(JSON.stringify(defaults.get(model.id))) as { [key: string]: Json } }
      : {}),
  }));
}
const adapterLocks = new WeakMap<NativeAdapter, Map<string, Promise<void>>>();
export function credentialSerial<T>(
  adapter: NativeAdapter,
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  let locks = adapterLocks.get(adapter);
  if (!locks) {
    locks = new Map();
    adapterLocks.set(adapter, locks);
  }
  const result = (locks.get(key) ?? Promise.resolve()).then(action);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, tail);
  void tail.then(() => {
    if (locks?.get(key) === tail) locks.delete(key);
  });
  return result;
}

export function createInstanceRuntime(
  instances: ProviderInstance[],
  native: NativeAdapter,
  options: {
    legacyCredential?: () => string | undefined;
    factories?: () => Provider[];
    state?: ProviderState;
  } = {},
) {
  const suppliers = new Map(
    (options.factories?.() ?? builtins()).map((provider) => [provider.id, provider]),
  );
  const catalogSuppliers = new Map<string, Provider>();
  const definitions = new Map(instances.map((item) => [item.id, structuredClone(item)]));
  function requireInstance(id: string) {
    const item = definitions.get(id);
    if (!item) throw new Error("接入实例不存在");
    return item;
  }
  async function readUnlocked(id: string): Promise<Credential | undefined> {
    const item = requireInstance(id);
    if (item.auth.type === "ambient") return undefined;
    const source = item.auth.source;
    const credential = await native.readCredential(source);
    if (credential) {
      if (item.auth.type === "oauth" && credential.type !== "oauth")
        throw new Error("认证方式与存储凭据类型不匹配");
      if (item.auth.type === "apiKey" && credential.type !== "api_key")
        throw new Error("认证方式与存储凭据类型不匹配");
      return credential;
    }
    if (
      item.id === "deepseek" &&
      source.type === "keyring" &&
      source.entry === "deepseek-api-key" &&
      options.legacyCredential?.()
    )
      return { type: "api_key", key: options.legacyCredential() };
    return undefined;
  }
  async function read(id: string): Promise<Credential | undefined> {
    const item = requireInstance(id);
    if (item.auth.type === "ambient") return undefined;
    return credentialSerial(native, JSON.stringify(item.auth.source), () => readUnlocked(id));
  }
  const credentials: CredentialStore = {
    read,
    async list() {
      const result = [];
      for (const item of instances) {
        const credential = await read(item.id);
        if (credential) result.push({ providerId: item.id, type: credential.type });
      }
      return result;
    },
    async modify(id, fn, authOptions) {
      const item = requireInstance(id);
      if (item.auth.type === "ambient" || item.auth.source.type === "env")
        throw new Error("此认证来源不可写入");
      const source = item.auth.source;
      return credentialSerial(native, JSON.stringify(source), async () => {
        authOptions?.signal?.throwIfAborted();
        const current = await readUnlocked(id);
        const next = await fn(current);
        if (next) await native.writeCredential(source, next);
        return next ?? current;
      });
    },
    async delete(id, authOptions) {
      const item = requireInstance(id);
      if (item.auth.type === "ambient" || item.auth.source.type === "env")
        throw new Error("此认证来源不可删除");
      const source = item.auth.source;
      await credentialSerial(native, JSON.stringify(source), async () => {
        authOptions?.signal?.throwIfAborted();
        await native.deleteCredential(source);
      });
    },
  };
  const models = createModels({
    credentials,
    modelsStore: options.state?.store(instances),
    authContext: {
      async env(name) {
        return (await native.env(name)) ?? undefined;
      },
      fileExists: (path) => native.fileExists(path),
    },
  });
  for (const item of instances) {
    const supplier =
      item.type === "radius"
        ? radiusProvider({ gateway: item.baseUrl })
        : (options.factories?.() ?? builtins()).find((provider) => provider.id === item.type);
    if (supplier) suppliers.set(item.type, supplier);
    if (!supplier) throw new Error("供应商类型不可用");
    const nativeApis = new Set(supplier.getModels().map((model) => model.api));
    if (item.type === "radius") nativeApis.add("pi-messages");
    const catalogSupplier: Provider = {
      ...supplier,
      getModels: () => {
        const cached = options.state?.get(item);
        return cached
          ? cached.models.filter(
              (model): model is Model<Api> => !model.type || model.type === "chat",
            )
          : supplier.getModels();
      },
    };
    catalogSuppliers.set(item.id, catalogSupplier);
    const dispatch = (api: string) => (nativeApis.has(api) ? supplier : chatApis[api]!);
    const assertEnabled = () => {
      if (!item.enabled) throw new Error("接入实例已停用");
    };
    const resolvedEnv: Record<string, string> = {};
    const ctx: AuthContext = {
      async env(name) {
        const value =
          item.parameters?.[name] ??
          (item.auth.type === "ambient" || (item.auth.type === "apiKey" && item.auth.useEnvironment)
            ? ((await native.env(name)) ?? undefined)
            : undefined);
        if (value) resolvedEnv[name] = value;
        return value;
      },
      fileExists: (path) => native.fileExists(path),
    };
    async function resolve(
      input: Parameters<NonNullable<ProviderAuth["apiKey"]>["resolve"]>[0],
    ): Promise<AuthResult | undefined> {
      assertEnabled();
      if (!supplier?.auth.apiKey) return undefined;
      if (
        item.auth.type !== "ambient" &&
        !(item.auth.type === "apiKey" && item.auth.useEnvironment) &&
        !input.credential?.key
      )
        return undefined;
      const credential = input.credential
        ? { ...input.credential, env: { ...item.parameters, ...input.credential.env } }
        : item.parameters
          ? { type: "api_key" as const, env: item.parameters }
          : undefined;
      const result = await supplier.auth.apiKey.resolve({ ...input, ctx, credential });
      if (!result) return undefined;
      return {
        ...result,
        auth: result.auth,
        env: { ...resolvedEnv, ...item.parameters, ...result.env },
      };
    }
    const auth: ProviderAuth =
      item.auth.type === "oauth"
        ? { oauth: supplier.auth.oauth }
        : {
            apiKey: {
              name: supplier.auth.apiKey?.name ?? item.name,
              resolve,
              async check(input) {
                return (await resolve(input))
                  ? { type: "api_key", source: item.auth.type }
                  : undefined;
              },
            },
          };
    const supplierModel = async (model: Model<Api>): Promise<Model<Api>> => {
      assertEnabled();
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(model.headers ?? {})) {
        const match = /\$\{credential:([^{}]+)\}/.exec(value);
        if (!match) {
          headers[name] = value;
          continue;
        }
        if (item.auth.type === "ambient") throw new Error("Header 凭据引用必须绑定实例来源");
        const source = item.auth.source;
        const entry = source.type === "env" ? source.variable : source.entry;
        if (match[1] !== entry) throw new Error("Header 凭据引用不属于此实例");
        const credential = await read(item.id);
        if (credential?.type !== "api_key" || !credential.key)
          throw new Error("Header 凭据来源缺失");
        headers[name] = value.replace(match[0], credential.key);
      }
      return { ...model, provider: supplier.id, headers };
    };
    const provider: Provider = {
      ...supplier,
      id: item.id,
      name: item.name,
      baseUrl: item.baseUrl ?? supplier.baseUrl,
      auth,
      getModels: () => effectiveModels(item, catalogSupplier),
      getAllModels: () => effectiveModels(item, catalogSupplier),
      filterModels: supplier.filterModels
        ? (listed, credential) => {
            const originals = listed.map((model) => ({ ...model, provider: supplier.id }));
            const allowed = new Set(
              supplier.filterModels!(originals, credential).map((model) => model.id),
            );
            return listed.filter((model) => allowed.has(model.id));
          }
        : undefined,
      filterAllModels: undefined,
      stream: (model, context, streamOptions) =>
        lazyStream(model, async () =>
          dispatch(model.api).stream(await supplierModel(model), context, streamOptions),
        ),
      streamSimple: (model, context, streamOptions) =>
        lazyStream(model, async () =>
          dispatch(model.api).streamSimple(await supplierModel(model), context, streamOptions),
        ),
      fetchDeferred: supplier.fetchDeferred
        ? (model, handle, streamOptions) =>
            lazyStream(model, async () =>
              supplier.fetchDeferred!(await supplierModel(model), handle, streamOptions),
            )
        : undefined,
      cancelDeferred: supplier.cancelDeferred
        ? async (model, handle, streamOptions) =>
            supplier.cancelDeferred!(await supplierModel(model), handle, streamOptions)
        : undefined,
      generateImages: undefined,
      classify: undefined,
    };
    models.setProvider(provider);
  }
  return { models, credentials, suppliers, catalogSuppliers, definitions, requireInstance };
}
export function validateEffective(instance: ProviderInstance): ProviderInstance {
  const parsed = parseInstance(instance);
  const supplier =
    parsed.type === "radius"
      ? radiusProvider({ gateway: parsed.baseUrl })
      : builtins().find((provider) => provider.id === parsed.type);
  if (!supplier) throw new Error("供应商类型不可用");
  const resolved = effectiveModels(parsed, supplier);
  if (
    !supplier.refreshModels &&
    parsed.visibleModels.some((id) => !resolved.some((model) => model.id === id))
  )
    throw new Error("可见模型不存在");
  for (const model of resolved)
    for (const value of Object.values(model.headers ?? {})) {
      const entry = /\$\{credential:([^{}]+)\}/.exec(value)?.[1];
      if (!entry) continue;
      if (parsed.auth.type === "ambient") throw new Error("Header 凭据引用无效");
      const source = parsed.auth.source;
      if (entry !== (source.type === "env" ? source.variable : source.entry))
        throw new Error("Header 凭据引用不属于此实例");
    }
  return parsed;
}
export const loginId = () => randomUUID();
export type InstanceRuntime = ReturnType<typeof createInstanceRuntime>;
export type { MutableModels };
