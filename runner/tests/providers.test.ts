import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  lazyStream,
  type AssistantMessageEventStream,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstance } from "../../contracts/providers.js";
import { localNativeAdapter } from "../src/communication/native.js";
import { Configuration } from "../src/config/configuration.js";
import { createInstanceRuntime, effectiveModels, modelViews } from "../src/providers/runtime.js";
import { parseInstance } from "../src/providers/schema.js";
import { ProviderService } from "../src/providers/service.js";

const BASE_MODEL: Model<"openai-completions"> = {
  id: "m1",
  name: "Model One",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://supplier.example/v1",
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: 128_000,
  maxTokens: 8_192,
};

function instance(
  overrides: Partial<ProviderInstance> & Pick<ProviderInstance, "id">,
): ProviderInstance {
  return {
    name: overrides.id,
    type: "deepseek",
    enabled: true,
    auth: { type: "apiKey", source: { type: "env", variable: "TEST_KEY" } },
    visibleModels: ["m1"],
    modelOverrides: {},
    customModels: [],
    ...overrides,
  };
}

/** A supplier whose only job is to report the model and auth each dispatch received. */
function recordingSupplier(seen: { model?: Model<"openai-completions">; apiKey?: string }) {
  const supplier: Provider<"openai-completions"> = {
    id: "deepseek",
    name: "Recording supplier",
    auth: {
      apiKey: {
        name: "test key",
        resolve: async ({ credential }) =>
          credential?.key ? { auth: { apiKey: credential.key }, source: "test" } : undefined,
      },
    },
    getModels: () => [BASE_MODEL],
    stream: () => unreachable(),
    streamSimple: (model, _context, options): AssistantMessageEventStream => {
      seen.model = model;
      seen.apiKey = options?.apiKey;
      return lazyStream(model, async () => {
        throw new Error("captured dispatch");
      });
    },
  };
  return supplier;
}

function unreachable(): AssistantMessageEventStream {
  throw new Error("stream() should not be used by the simple path");
}

async function dispatch(
  models: ReturnType<typeof createInstanceRuntime>["models"],
  instanceId: string,
  options?: SimpleStreamOptions,
) {
  const model = models.getModel(instanceId, "m1");
  if (!model) throw new Error("missing model");
  // pi-ai reports stream-side failures as an error message instead of rejecting result().
  const message = await models.streamSimple(model, { messages: [] }, options).result();
  expect(message.stopReason).toBe("error");
  return message;
}

describe("provider instances", () => {
  it("reports environment names without exposing credentials in the settings response", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agentchat-provider-settings-"));
    try {
      const configuration = await Configuration.open(dataDir);
      const service = new ProviderService(
        configuration,
        localNativeAdapter({ DEEPSEEK_API_KEY: "private-environment-key" }),
        () => undefined,
        async () => [],
      );
      const response = await service.request({ action: "list", type: "deepseek" });
      expect(response.catalog?.find((entry) => entry.type === "deepseek")?.environment).toEqual({
        variables: ["DEEPSEEK_API_KEY"],
        detected: ["DEEPSEEK_API_KEY"],
      });
      expect(JSON.stringify(response)).not.toContain("private-environment-key");
      const missing = new ProviderService(
        configuration,
        localNativeAdapter({}),
        () => undefined,
        async () => [],
      );
      const empty = await missing.request({ action: "list", type: "deepseek" });
      expect(
        empty.catalog?.find((entry) => entry.type === "deepseek")?.environment?.detected,
      ).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  it("keeps the settings list available when environment detection fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agentchat-provider-detection-"));
    try {
      const configuration = await Configuration.open(dataDir);
      const runner = configuration.runner;
      if (!runner) throw new Error("runner configuration unavailable");
      const providers = {
        ...runner.providers,
        deepseek: {
          ...instance({ id: "deepseek" }),
          auth: {
            type: "apiKey" as const,
            source: { type: "keyring" as const, entry: "deepseek" },
          },
        },
      };
      await configuration.saveConfiguration(
        "runner.json",
        (await configuration.readConfiguration("runner.json")).version,
        `${JSON.stringify({ ...runner, schemaVersion: 2, providers }, null, 2)}\n`,
      );
      const service = new ProviderService(
        configuration,
        {
          ...localNativeAdapter({}),
          async env() {
            throw new Error("environment bridge unavailable");
          },
        },
        () => undefined,
        async () => [],
      );
      const response = await service.request({ action: "list", type: "deepseek" });
      expect(response.catalog?.some((entry) => entry.type === "deepseek")).toBe(true);
      expect(response.instances?.[0]?.status).toBe("missing");
      expect(
        response.catalog?.find((entry) => entry.type === "deepseek")?.environment?.detectionError,
      ).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not mark cloud credentials missing when the public resolver accepts them", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agentchat-provider-cloud-auth-"));
    try {
      const configuration = await Configuration.open(dataDir);
      const service = new ProviderService(
        configuration,
        localNativeAdapter({
          AWS_PROFILE: "work",
          GOOGLE_CLOUD_API_KEY: "private-google-key",
        }),
        () => undefined,
        async () => [],
      );
      const bedrock = await service.request({ action: "list", type: "amazon-bedrock" });
      expect(
        bedrock.catalog?.find((entry) => entry.type === "amazon-bedrock")?.environment,
      ).toMatchObject({
        configured: true,
      });
      const vertex = await service.request({ action: "list", type: "google-vertex" });
      expect(
        vertex.catalog?.find((entry) => entry.type === "google-vertex")?.environment,
      ).toMatchObject({
        configured: true,
      });
      expect(JSON.stringify(vertex)).not.toContain("private-google-key");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses the supplier environment only when opted in and prefers stored keys", async () => {
    const native = localNativeAdapter({ DEEPSEEK_API_KEY: "environment-key" });
    const item = instance({
      id: "simple",
      auth: { type: "apiKey", source: { type: "keyring", entry: "simple" }, useEnvironment: true },
    });
    const runtime = createInstanceRuntime([item], native);
    expect((await runtime.models.getAuth("simple"))?.auth.apiKey).toBe("environment-key");
    await runtime.credentials.modify("simple", async () => ({
      type: "api_key",
      key: "stored-key",
    }));
    expect((await runtime.models.getAuth("simple"))?.auth.apiKey).toBe("stored-key");
    await runtime.credentials.delete("simple");
    expect((await runtime.models.getAuth("simple"))?.auth.apiKey).toBe("environment-key");
    const explicit = createInstanceRuntime(
      [
        instance({
          id: "explicit",
          auth: { type: "apiKey", source: { type: "keyring", entry: "missing" } },
        }),
      ],
      native,
    );
    expect(await explicit.models.getAuth("explicit")).toBeUndefined();
    expect(() =>
      parseInstance(
        instance({
          id: "invalid",
          auth: {
            type: "apiKey",
            source: { type: "env", variable: "MISSING" },
            useEnvironment: true,
          },
        }),
      ),
    ).toThrow("供应商配置无效");
  });

  it("keeps two instances of one supplier on their own endpoint and credential", async () => {
    const seenA: { model?: Model<"openai-completions">; apiKey?: string } = {};
    const seenB: typeof seenA = {};
    const native = localNativeAdapter({ KEY_A: "key-a", KEY_B: "key-b" });
    const a = instance({
      id: "work-a",
      baseUrl: "https://a.example/v1",
      auth: { type: "apiKey", source: { type: "env", variable: "KEY_A" } },
    });
    const b = instance({
      id: "work-b",
      baseUrl: "https://b.example/v1",
      auth: { type: "apiKey", source: { type: "env", variable: "KEY_B" } },
    });
    const runtimeA = createInstanceRuntime([a, b], native, {
      factories: () => [recordingSupplier(seenA)],
    });
    await dispatch(runtimeA.models, "work-a");
    expect(seenA.model?.baseUrl).toBe("https://a.example/v1");
    expect(seenA.apiKey).toBe("key-a");
    // The same runtime serves both instances; dispatch must not reuse the first instance's data.
    await dispatch(runtimeA.models, "work-b");
    expect(seenB.model).toBeUndefined();
    expect(seenA.model?.baseUrl).toBe("https://b.example/v1");
    expect(seenA.apiKey).toBe("key-b");

    const seenC: typeof seenA = {};
    const runtimeB = createInstanceRuntime(
      [b],
      localNativeAdapter({ KEY_A: "key-a", KEY_B: "key-b" }),
      {
        factories: () => [recordingSupplier(seenC)],
      },
    );
    await dispatch(runtimeB.models, "work-b");
    expect(seenC.model?.baseUrl).toBe("https://b.example/v1");
  });

  it("lets a model override its endpoint and restores the supplier baseline after removal", () => {
    const native = localNativeAdapter({});
    const base = instance({ id: "work", baseUrl: "https://instance.example/v1" });
    const overridden = instance({
      id: "work",
      baseUrl: "https://instance.example/v1",
      modelOverrides: { m1: { baseUrl: "https://model.example/v1", maxTokens: 1024 } },
    });
    const supplier = recordingSupplier({});
    expect(effectiveModels(overridden, supplier)[0]?.baseUrl).toBe("https://model.example/v1");
    expect(effectiveModels(overridden, supplier)[0]?.maxTokens).toBe(1024);
    expect(effectiveModels(base, supplier)[0]?.baseUrl).toBe("https://instance.example/v1");
    const view = modelViews(overridden, supplier)[0];
    expect(view?.overridden).toBe(true);
    expect(view?.defaults?.baseUrl).toBe("https://instance.example/v1");
    expect(view?.definition.baseUrl).toBe("https://model.example/v1");
    expect(native).toBeDefined();
  });

  it("does not fall back to another instance or ambient environment when a source is missing", async () => {
    const native = localNativeAdapter({ KEY_A: "key-a" });
    const missing = instance({
      id: "missing",
      auth: { type: "apiKey", source: { type: "env", variable: "MISSING_KEY" } },
    });
    const runtime = createInstanceRuntime([missing], native, {
      factories: () => [recordingSupplier({})],
    });
    await expect(runtime.models.checkAuth("missing")).resolves.toBeUndefined();
    const model = runtime.models.getModel("missing", "m1");
    expect(model).toBeDefined();
    const message = await runtime.models.streamSimple(model!, { messages: [] }).result();
    expect(message.stopReason).toBe("error");
  });

  it("refuses dispatch after an instance is disabled", async () => {
    const captured: { model?: Model<"openai-completions"> } = {};
    const runtime = createInstanceRuntime(
      [
        instance({
          id: "off",
          enabled: false,
          auth: { type: "apiKey", source: { type: "env", variable: "KEY_A" } },
        }),
      ],
      localNativeAdapter({ KEY_A: "key-a" }),
      { factories: () => [recordingSupplier(captured)] },
    );
    const model = runtime.models.getModel("off", "m1");
    expect(model).toBeDefined();
    const message = await runtime.models.streamSimple(model!, { messages: [] }).result();
    expect(message.stopReason).toBe("error");
    expect(captured.model).toBeUndefined();
  });

  it("resolves only the instance's own credential reference in headers", async () => {
    const seen: { model?: Model<"openai-completions">; apiKey?: string } = {};
    const source = { type: "env" as const, variable: "KEY_A" };
    const own = instance({
      id: "own",
      auth: { type: "apiKey", source },
      modelOverrides: { m1: { headers: { Authorization: "Bearer ${credential:KEY_A}" } } },
    });
    const runtime = createInstanceRuntime([own], localNativeAdapter({ KEY_A: "key-a" }), {
      factories: () => [recordingSupplier(seen)],
    });
    await dispatch(runtime.models, "own");
    expect(seen.model?.headers?.Authorization).toBe("Bearer key-a");
    expect(seen.apiKey).toBe("key-a");

    const foreign = instance({
      id: "foreign",
      auth: { type: "apiKey", source },
      modelOverrides: { m1: { headers: { Authorization: "Bearer ${credential:SOMETHING_ELSE}" } } },
    });
    const forbidden = createInstanceRuntime([foreign], localNativeAdapter({ KEY_A: "key-a" }), {
      factories: () => [recordingSupplier({})],
    });
    const model = forbidden.models.getModel("foreign", "m1");
    const message = await forbidden.models.streamSimple(model!, { messages: [] }).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("Header 凭据引用不属于此实例");
  });

  it("rejects raw secrets in configuration and keeps credentials out of model JSON", () => {
    expect(() =>
      parseInstance(
        instance({
          id: "raw",
          modelOverrides: { m1: { headers: { Authorization: "Bearer plaintext-placeholder" } } },
        }),
      ),
    ).toThrow("供应商配置无效");
    expect(() =>
      parseInstance(
        instance({
          id: "sampling",
          modelOverrides: { m1: { samplingParams: { api_key: "plaintext-placeholder" } } },
        }),
      ),
    ).toThrow("供应商配置无效");
    expect(() =>
      parseInstance(instance({ id: "url", baseUrl: "https://user:password@host/v1" })),
    ).toThrow("供应商配置无效");
    const runtime = createInstanceRuntime(
      [instance({ id: "clean" })],
      localNativeAdapter({ TEST_KEY: "secret-value" }),
      {
        factories: () => [recordingSupplier({})],
      },
    );
    expect(
      JSON.stringify(modelViews(runtime.requireInstance("clean"), recordingSupplier({}))),
    ).not.toContain("secret-value");
  });

  it("round-trips custom model definitions through validation", () => {
    const custom = JSON.parse(
      JSON.stringify({
        ...BASE_MODEL,
        id: "custom-1",
        name: "Custom One",
        provider: "custom",
        baseUrl: "https://custom.example/v1",
      }),
    ) as { [key: string]: string | number | boolean | string[] | Record<string, number> };
    const parsed = parseInstance(instance({ id: "custom", customModels: [custom] }));
    const supplier = recordingSupplier({});
    const models = effectiveModels(parsed, supplier);
    expect(models.map((model) => model.id)).toEqual(["m1", "custom-1"]);
    expect(models[1]?.provider).toBe("custom");
  });
});
