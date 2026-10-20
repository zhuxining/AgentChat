import { Type, type Api, type Model, type TSchema } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  AnthropicMessagesCompatSchema,
  BedrockCompatSchema,
  MistralConversationsCompatSchema,
  OpenAICompletionsCompatSchema,
  OpenAIResponsesCompatSchema,
} from "@earendil-works/pi-ai/providers/compat-schema";
import {
  ModelCostSchema,
  ModelInputLimitsSchema,
  ModelPromptCacheSchema,
  ThinkingLevelMapSchema,
} from "@earendil-works/pi-ai/providers/model-schema";
import { Check } from "typebox/value";

import type { CredentialSource, ProviderInstance } from "../../../contracts/providers.js";
import { chatApis } from "./apis.js";

const id = Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$" });
const text = Type.String({ minLength: 1, maxLength: 2000, pattern: "^[^\\u0000]*$" });
const headers = Type.Record(
  Type.String({ minLength: 1, maxLength: 200 }),
  Type.String({ maxLength: 8000 }),
);
const parameters = Type.Record(Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,119}$" }), text);
const keyring = Type.Object(
  { type: Type.Literal("keyring"), entry: text },
  { additionalProperties: false },
);
export const CredentialSourceSchema = Type.Union([
  keyring,
  Type.Object(
    {
      type: Type.Literal("env"),
      variable: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,119}$" }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("file"), path: text, entry: text },
    { additionalProperties: false },
  ),
]);
const sampling = Type.Record(Type.String(), Type.Unknown());
export const modelProperties = {
  id: text,
  name: text,
  api: text,
  provider: text,
  baseUrl: Type.String({ maxLength: 2000 }),
  input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), {
    minItems: 1,
    uniqueItems: true,
  }),
  inputLimits: Type.Optional(ModelInputLimitsSchema),
  cost: ModelCostSchema,
  headers: Type.Optional(headers),
  type: Type.Optional(Type.Literal("chat")),
  reasoning: Type.Boolean(),
  thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
  promptCache: Type.Optional(ModelPromptCacheSchema),
  contextWindow: Type.Integer({ minimum: 1 }),
  maxTokens: Type.Integer({ minimum: 1 }),
  samplingParams: Type.Optional(sampling),
  samplingParamsByThinkingLevel: Type.Optional(
    Type.Partial(
      Type.Record(Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]), sampling),
    ),
  ),
  compat: Type.Optional(Type.Object({}, { additionalProperties: true })),
};
const ModelSchema = Type.Object(modelProperties, { additionalProperties: false });
const InstanceSchema = Type.Object(
  {
    id,
    name: text,
    type: text,
    enabled: Type.Boolean(),
    custom: Type.Optional(Type.Boolean()),
    baseUrl: Type.Optional(text),
    headers: Type.Optional(headers),
    auth: Type.Union([
      Type.Object(
        {
          type: Type.Literal("apiKey"),
          source: CredentialSourceSchema,
          useEnvironment: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { type: Type.Literal("oauth"), source: keyring },
        { additionalProperties: false },
      ),
      Type.Object({ type: Type.Literal("ambient") }, { additionalProperties: false }),
    ]),
    parameters: Type.Optional(parameters),
    visibleModels: Type.Array(text, { uniqueItems: true, maxItems: 2000 }),
    modelOverrides: Type.Record(text, Type.Partial(ModelSchema)),
    customModels: Type.Array(ModelSchema, { maxItems: 2000 }),
  },
  { additionalProperties: false },
);
export const ambientProviders = new Set(["amazon-bedrock", "google-vertex", "anthropic"]);
const compatByApi: Record<string, TSchema> = {
  "openai-completions": OpenAICompletionsCompatSchema,
  "openai-responses": OpenAIResponsesCompatSchema,
  "azure-openai-responses": OpenAIResponsesCompatSchema,
  "openai-codex-responses": OpenAIResponsesCompatSchema,
  "anthropic-messages": AnthropicMessagesCompatSchema,
  "bedrock-converse-stream": BedrockCompatSchema,
  "mistral-conversations": MistralConversationsCompatSchema,
};
/** Tighten public schemas' unknown object fields, preserving intentional records. */
function strict(schema: TSchema): TSchema {
  const copy = structuredClone(schema);
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "object" && record.properties) record.additionalProperties = false;
    for (const item of Object.values(record)) visit(item);
  }
  visit(copy);
  return copy;
}
function fail(): never {
  throw new Error("供应商配置无效，请检查字段、模型定义及凭据引用");
}
export function validateSource(source: CredentialSource): void {
  if (!Check(CredentialSourceSchema, source)) fail();
  if (
    source.type === "file" &&
    (!/^credentials\/[a-zA-Z0-9_./-]+\.json$/.test(source.path) ||
      source.path.split("/").some((part) => part === "." || part === ".." || !part))
  )
    fail();
}
export function validateHeaders(value: Record<string, string> | undefined): void {
  for (const [key, item] of Object.entries(value ?? {})) {
    if (/[\r\n\0]/.test(key + item)) fail();
    if (
      /authorization|api[-_]?key|token|cookie|secret/i.test(key) &&
      !/^(?:Bearer |Basic )?\$\{credential:[^{}]+\}$/.test(item)
    )
      fail();
    if (item.includes("${") && !/^(?:Bearer |Basic )?\$\{credential:[^{}]+\}$/.test(item)) fail();
  }
}
function secureJSON(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) secureJSON(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) fail();
    if (/^(api[-_]?key|authorization|access_token|refresh_token|secret|password)$/i.test(key))
      fail();
    secureJSON(item);
  }
}
export function parseChatModel(value: unknown): Model<Api> {
  if (!Check(ModelSchema, value)) fail();
  const model = value as Model<Api>; // ModelSchema checks every serialized Model<Api> field before narrowing.
  if (!Object.hasOwn(chatApis, model.api)) fail();
  if (
    model.compat &&
    !Check(
      strict(compatByApi[model.api] ?? Type.Object({}, { additionalProperties: false })),
      model.compat,
    )
  )
    fail();
  if (model.baseUrl) {
    try {
      const url = new URL(model.baseUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail();
    } catch {
      fail();
    }
  }
  validateHeaders(model.headers);
  secureJSON(model.samplingParams);
  secureJSON(model.samplingParamsByThinkingLevel);
  return structuredClone(model);
}
export function parseInstance(value: unknown): ProviderInstance {
  if (!Check(InstanceSchema, value)) fail();
  const instance = value as ProviderInstance;
  const provider = builtinProviders().find((item) => item.id === instance.type);
  if (
    !provider ||
    (instance.auth.type === "oauth" && !provider.auth.oauth) ||
    (instance.auth.type === "apiKey" && !provider.auth.apiKey) ||
    (instance.auth.type === "ambient" && !ambientProviders.has(instance.type))
  )
    fail();
  if (
    instance.auth.type === "apiKey" &&
    instance.auth.useEnvironment &&
    instance.auth.source.type !== "keyring"
  )
    fail();
  if (instance.auth.type !== "ambient") validateSource(instance.auth.source);
  validateHeaders(instance.headers);
  if (
    Object.keys(instance.parameters ?? {}).some(
      (key) =>
        /KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION/.test(key) &&
        key !== "GOOGLE_APPLICATION_CREDENTIALS",
    )
  )
    fail();
  if (instance.baseUrl) {
    try {
      const url = new URL(instance.baseUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail();
    } catch {
      fail();
    }
  }
  const customIds = new Set<string>();
  for (const model of instance.customModels) {
    const parsed = parseChatModel(model);
    if (parsed.provider !== instance.id || customIds.has(parsed.id)) fail();
    customIds.add(parsed.id);
  }
  for (const [modelId, override] of Object.entries(instance.modelOverrides)) {
    if (
      (override.id !== undefined && override.id !== modelId) ||
      (override.provider !== undefined && override.provider !== instance.id)
    )
      fail();
    validateHeaders(override.headers as Record<string, string> | undefined);
    secureJSON(override.samplingParams);
    secureJSON(override.samplingParamsByThinkingLevel);
  }
  return structuredClone(instance);
}
export function legacyInstance(): ProviderInstance {
  return {
    id: "deepseek",
    name: "DeepSeek",
    type: "deepseek",
    enabled: true,
    auth: { type: "apiKey", source: { type: "keyring", entry: "deepseek-api-key" } },
    visibleModels: ["deepseek-chat", "deepseek-reasoner"],
    modelOverrides: {},
    customModels: [],
  };
}
