import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { Type, type TSchema } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type { McpServerConfiguration } from "../config/schema.js";

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 2_500;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_SCHEMA_NODES = 256;
const MAX_SCHEMA_DEPTH = 12;
const MAX_STRING_LENGTH = 65_536;
const MAX_ARRAY_ITEMS = 1_000;
const MAX_OBJECT_PROPERTIES = 100;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type McpServerStatus = {
  id: string;
  name: string;
  status: "connecting" | "connected" | "failed";
  toolCount: number;
  skippedToolCount: number;
  message?: string;
};

type JsonObject = Record<string, unknown>;
type McpTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
};
type ServerEntry = {
  configuration: McpServerConfiguration;
  key: string;
  extensionName: string;
  client: Client;
  transport: StdioClientTransport;
  calls: number;
  retired: boolean;
  closePromise?: Promise<void>;
  drained: Promise<void>;
  drain: () => void;
  displayNames: Map<string, string>;
};

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function schemaFailure(): never {
  throw new Error("unsupported MCP tool schema");
}

function integerField(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    schemaFailure();
  return value;
}

function finiteField(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) schemaFailure();
  return value;
}

function supportedPattern(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) schemaFailure();
  try {
    new RegExp(value);
  } catch {
    schemaFailure();
  }

  let inCharacterClass = false;
  let escaped = false;
  let quantifiers = 0;
  // Avoid backtracking constructs; one anchored repetition keeps validation linear in input size.
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (escaped) {
      if (/[1-9]/.test(character) || character === "k") schemaFailure();
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "(" || character === ")" || character === "|") schemaFailure();
    if (character === "*" || character === "+" || character === "?") {
      quantifiers++;
    } else if (character === "{") {
      const match = /^\{(\d+)(?:,(\d*))?\}/.exec(value.slice(index));
      if (!match) schemaFailure();
      const minimum = Number(match[1]);
      const maximum =
        match[2] === undefined ? minimum : match[2] === "" ? undefined : Number(match[2]);
      if (
        !Number.isSafeInteger(minimum) ||
        minimum > MAX_STRING_LENGTH ||
        (maximum !== undefined &&
          (!Number.isSafeInteger(maximum) || maximum > MAX_STRING_LENGTH || minimum > maximum))
      ) {
        schemaFailure();
      }
      quantifiers++;
      index += match[0].length - 1;
    } else if (character === "}") {
      schemaFailure();
    }
    if (quantifiers > 1) schemaFailure();
  }
  if (escaped || inCharacterClass || (quantifiers > 0 && !value.startsWith("^"))) {
    schemaFailure();
  }
  return value;
}

function primitiveLiteral(value: unknown): TSchema {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return Type.Literal(value);
  if (value === null) return Type.Null();
  return schemaFailure();
}

function literalMatchesType(value: unknown, type: string | undefined): boolean {
  switch (type) {
    case undefined:
      return true;
    case "object":
      return record(value) !== undefined;
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

export function jsonSchemaToTypeBox(value: unknown): TSchema {
  let nodes = 0;
  function convert(input: unknown, depth: number): TSchema {
    if (depth > MAX_SCHEMA_DEPTH || ++nodes > MAX_SCHEMA_NODES) schemaFailure();
    const schema = record(input);
    if (!schema) schemaFailure();
    const metadata = new Set(["$schema", "title", "description", "type", "enum", "const"]);
    const allowed = new Set([
      "$schema",
      "title",
      "description",
      "type",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "enum",
      "const",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "minLength",
      "maxLength",
      "pattern",
      "minItems",
      "maxItems",
      "uniqueItems",
    ]);
    if (Object.keys(schema).some((key) => !allowed.has(key))) schemaFailure();

    const schemaType = schema.type;
    if (schemaType !== undefined && typeof schemaType !== "string") schemaFailure();
    if (
      schemaType !== undefined &&
      !["object", "string", "number", "integer", "boolean", "null", "array"].includes(schemaType)
    ) {
      schemaFailure();
    }
    let base: TSchema;
    if (schemaType === "object" || (schemaType === undefined && schema.properties !== undefined)) {
      const objectKeywords = new Set([
        ...metadata,
        "properties",
        "required",
        "additionalProperties",
      ]);
      if (Object.keys(schema).some((key) => !objectKeywords.has(key))) schemaFailure();
      const properties = record(schema.properties ?? {});
      if (!properties || Object.keys(properties).length > MAX_OBJECT_PROPERTIES) schemaFailure();
      const requiredValue = schema.required ?? [];
      if (!Array.isArray(requiredValue) || requiredValue.some((item) => typeof item !== "string"))
        schemaFailure();
      const required = new Set(requiredValue as string[]);
      if (required.size !== requiredValue.length) schemaFailure();
      for (const name of required) {
        if (!Object.hasOwn(properties, name) || UNSAFE_KEYS.has(name)) schemaFailure();
      }
      const fields: Record<string, TSchema> = {};
      for (const [name, property] of Object.entries(properties)) {
        if (UNSAFE_KEYS.has(name)) schemaFailure();
        const converted = convert(property, depth + 1);
        Object.defineProperty(fields, name, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: required.has(name) ? converted : Type.Optional(converted),
        });
      }
      const additional = schema.additionalProperties;
      if (additional !== undefined && typeof additional !== "boolean") schemaFailure();
      base = Type.Object(fields, { additionalProperties: additional !== false });
    } else if (schemaType === "string") {
      const stringKeywords = new Set([...metadata, "minLength", "maxLength", "pattern"]);
      if (Object.keys(schema).some((key) => !stringKeywords.has(key))) schemaFailure();
      const minLength = integerField(schema.minLength, MAX_STRING_LENGTH);
      const maxLength = integerField(schema.maxLength, MAX_STRING_LENGTH);
      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength)
        schemaFailure();
      let pattern: string | undefined;
      if (schema.pattern !== undefined) {
        pattern = supportedPattern(schema.pattern);
      }
      base = Type.String({
        ...(minLength === undefined ? {} : { minLength }),
        maxLength: maxLength ?? MAX_STRING_LENGTH,
        ...(pattern === undefined ? {} : { pattern }),
      });
    } else if (schemaType === "number" || schemaType === "integer") {
      const numberKeywords = new Set([
        ...metadata,
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
      ]);
      if (Object.keys(schema).some((key) => !numberKeywords.has(key))) schemaFailure();
      const minimum = finiteField(schema.minimum);
      const maximum = finiteField(schema.maximum);
      const exclusiveMinimum = finiteField(schema.exclusiveMinimum);
      const exclusiveMaximum = finiteField(schema.exclusiveMaximum);
      if (
        (minimum !== undefined && maximum !== undefined && minimum > maximum) ||
        (exclusiveMinimum !== undefined &&
          exclusiveMaximum !== undefined &&
          exclusiveMinimum >= exclusiveMaximum)
      )
        schemaFailure();
      const options = {
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
        ...(exclusiveMinimum === undefined ? {} : { exclusiveMinimum }),
        ...(exclusiveMaximum === undefined ? {} : { exclusiveMaximum }),
      };
      base = schemaType === "integer" ? Type.Integer(options) : Type.Number(options);
    } else if (schemaType === "boolean") {
      if (Object.keys(schema).some((key) => !metadata.has(key))) schemaFailure();
      base = Type.Boolean();
    } else if (schemaType === "null") {
      if (Object.keys(schema).some((key) => !metadata.has(key))) schemaFailure();
      base = Type.Null();
    } else if (schemaType === "array") {
      const arrayKeywords = new Set([...metadata, "items", "minItems", "maxItems", "uniqueItems"]);
      if (Object.keys(schema).some((key) => !arrayKeywords.has(key))) schemaFailure();
      if (schema.items === undefined) schemaFailure();
      const minItems = integerField(schema.minItems, MAX_ARRAY_ITEMS);
      const maxItems = integerField(schema.maxItems, MAX_ARRAY_ITEMS);
      if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) schemaFailure();
      if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean")
        schemaFailure();
      base = Type.Array(convert(schema.items, depth + 1), {
        ...(minItems === undefined ? {} : { minItems }),
        maxItems: maxItems ?? MAX_ARRAY_ITEMS,
        ...(schema.uniqueItems === undefined ? {} : { uniqueItems: schema.uniqueItems }),
      });
    } else if (
      schemaType === undefined &&
      schema.const === undefined &&
      schema.enum === undefined
    ) {
      schemaFailure();
    } else {
      base = Type.Unknown();
    }

    const literalType = schemaType ?? (schema.properties === undefined ? undefined : "object");
    if (schema.const !== undefined) {
      if (!literalMatchesType(schema.const, literalType)) schemaFailure();
      base = Type.Intersect([base, primitiveLiteral(schema.const)]);
    }
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 100)
        schemaFailure();
      if (!schema.enum.every((item) => literalMatchesType(item, literalType))) schemaFailure();
      const literals = schema.enum.map(primitiveLiteral);
      const encoded = schema.enum.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) schemaFailure();
      const enumeration = literals.length === 1 ? literals[0]! : Type.Union(literals);
      base = Type.Intersect([base, enumeration]);
    }
    return base;
  }

  const schema = record(value);
  if (!schema || schema.type !== "object") schemaFailure();
  return convert(value, 0);
}

export function mcpToolPrefix(serverId: string): string {
  const serverKey = createHash("sha256").update(serverId).digest("hex").slice(0, 16);
  return `mcp_${serverKey}_`;
}

function internalToolName(serverId: string, toolName: string): string {
  const slug = toolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const digest = createHash("sha256")
    .update(serverId)
    .update("\0")
    .update(toolName)
    .digest("hex")
    .slice(0, 24);
  // The server key lets configuration validation associate ephemeral tools with a server.
  // Keep provider-facing function names within the common 64-character limit.
  return `${mcpToolPrefix(serverId)}${slug.slice(0, 18) || "tool"}_${digest}`;
}

function asTool(value: unknown): McpTool | undefined {
  const tool = record(value);
  if (!tool || typeof tool.name !== "string" || !tool.name.trim() || tool.name.length > 256)
    return undefined;
  if (tool.description !== undefined && typeof tool.description !== "string") return undefined;
  return {
    name: tool.name,
    ...(typeof tool.description === "string"
      ? { description: tool.description.slice(0, 4_000) }
      : {}),
    inputSchema: tool.inputSchema,
  };
}

function textResult(content: string, isError = false) {
  return { output: [{ type: "text" as const, text: content }], isError };
}

function utf8Prefix(value: string, maxBytes: number): { text: string; truncated: boolean } {
  let text = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) return { text, truncated: true };
    text += character;
    bytes += characterBytes;
  }
  return { text, truncated: false };
}

function outputText(result: {
  content: readonly unknown[];
  isError?: boolean;
  structuredContent?: unknown;
}) {
  let output = "";
  let bytes = 0;
  let hasText = false;
  let truncated = false;
  const hasNonTextContent =
    result.structuredContent !== undefined ||
    result.content.some((block) => record(block)?.type !== "text");
  const omissionNotice = hasNonTextContent
    ? "\n[MCP 返回了文本以外的内容或结构化数据，本轮未传递给模型]"
    : "";
  const omissionNoticeBytes = Buffer.byteLength(omissionNotice, "utf8");
  const contentLimit = MAX_OUTPUT_BYTES - omissionNoticeBytes;
  for (const block of result.content) {
    const value = record(block);
    if (value?.type !== "text" || typeof value.text !== "string") continue;
    const separator = hasText ? "\n" : "";
    const separatorBytes = Buffer.byteLength(separator, "utf8");
    if (bytes + separatorBytes > contentLimit) {
      truncated = true;
      break;
    }
    const chunk = utf8Prefix(value.text, contentLimit - bytes - separatorBytes);
    output += separator + chunk.text;
    bytes += separatorBytes + Buffer.byteLength(chunk.text, "utf8");
    hasText = true;
    if (chunk.truncated) {
      truncated = true;
      break;
    }
  }
  if (!hasText) {
    output = hasNonTextContent
      ? "MCP 工具只返回了文本以外的内容或结构化数据；当前仅将文本传递给模型。"
      : "MCP 工具未返回文本内容。";
  }
  if (truncated) {
    const marker = "\n[输出已截断]";
    const prefix = utf8Prefix(
      output,
      MAX_OUTPUT_BYTES - Buffer.byteLength(marker, "utf8") - omissionNoticeBytes,
    );
    output = prefix.text + marker + omissionNotice;
  } else if (hasText) {
    output += omissionNotice;
  }
  return textResult(output, result.isError === true);
}

function abortError(): Error {
  const error = new Error("MCP 工具调用已取消");
  error.name = "AbortError";
  return error;
}

function waitAtMost(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createMcpServerManager(
  registry: ReturnType<typeof import("./registry.js").createRunnerRegistry>,
  dataDir: string,
) {
  const entries = new Map<string, ServerEntry>();
  const retired = new Set<ServerEntry>();
  const statuses = new Map<string, McpServerStatus>();
  const names = new Map<string, string>();
  const activeCalls = new Set<AbortController>();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  function installFailure(configuration: McpServerConfiguration, message: string) {
    statuses.set(configuration.id, {
      id: configuration.id,
      name: configuration.name,
      status: "failed",
      toolCount: 0,
      skippedToolCount: 0,
      message,
    });
  }

  function closeEntry(entry: ServerEntry) {
    if (!entry.closePromise) {
      entry.closePromise = Promise.allSettled([
        Promise.resolve().then(() => entry.client.close()),
        Promise.resolve().then(() => entry.transport.close()),
      ]).then(() => {
        retired.delete(entry);
      });
    }
    return entry.closePromise;
  }

  function retireEntry(entry: ServerEntry) {
    if (entry.retired) return;
    entry.retired = true;
    retired.add(entry);
    for (const name of entry.displayNames.keys()) names.delete(name);
    void entry.drained.then(() => closeEntry(entry));
    if (entry.calls === 0) entry.drain();
  }

  function disconnect(entry: ServerEntry, message?: string) {
    if (entries.get(entry.configuration.id) !== entry) return;
    entries.delete(entry.configuration.id);
    registry.uninstall({ name: entry.extensionName });
    if (message) installFailure(entry.configuration, message);
    else
      statuses.set(entry.configuration.id, {
        id: entry.configuration.id,
        name: entry.configuration.name,
        status: "failed",
        toolCount: 0,
        skippedToolCount: 0,
        message: "MCP Server 已断开，请重载配置以重新连接。",
      });
    retireEntry(entry);
  }

  async function connectServer(configuration: McpServerConfiguration, key: string) {
    const extensionName = `mcp-${configuration.id}`;
    const client = new Client({ name: "agentchat", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: configuration.command,
      args: configuration.args,
      cwd: configuration.cwd ? resolve(dataDir, configuration.cwd) : dataDir,
      stderr: "ignore",
      maxBufferSize: 1024 * 1024,
    });
    let drain: () => void = () => {};
    const entry: ServerEntry = {
      configuration,
      key,
      extensionName,
      client,
      transport,
      calls: 0,
      retired: false,
      drained: new Promise<void>((resolveDrain) => {
        drain = resolveDrain;
      }),
      drain: () => drain(),
      displayNames: new Map(),
    };
    entries.set(configuration.id, entry);
    statuses.set(configuration.id, {
      id: configuration.id,
      name: configuration.name,
      status: "connecting",
      toolCount: 0,
      skippedToolCount: 0,
    });
    transport.onclose = () => disconnect(entry);
    transport.onerror = () => disconnect(entry, "MCP Server 连接中断，请检查服务并重载配置。");

    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
      const result = await client.listTools({}, { timeout: CONNECT_TIMEOUT_MS });
      if (entries.get(configuration.id) !== entry || entry.retired) {
        retireEntry(entry);
        return;
      }
      const tools = Array.isArray(result.tools) ? result.tools : [];
      const installedTools = [];
      let skippedToolCount = 0;
      for (const candidate of tools) {
        const tool = asTool(candidate);
        if (!tool) {
          skippedToolCount++;
          continue;
        }
        let parameters: TSchema;
        try {
          parameters = jsonSchemaToTypeBox(tool.inputSchema);
        } catch {
          skippedToolCount++;
          continue;
        }
        const name = internalToolName(configuration.id, tool.name);
        const displayName = `${configuration.name} / ${tool.name}`;
        entry.displayNames.set(name, displayName);
        names.set(name, displayName);
        installedTools.push(
          defineTool({
            name,
            description: tool.description || `MCP 工具 ${tool.name}`,
            parameters,
            replay: "unsafe",
            async execute(args, _api, context) {
              if (entry.retired || entries.get(configuration.id) !== entry)
                return textResult("MCP 工具当前不可用，请重载连接后重试。", true);
              const shutdownController = new AbortController();
              activeCalls.add(shutdownController);
              const signal = context.abortSignal
                ? AbortSignal.any([context.abortSignal, shutdownController.signal])
                : shutdownController.signal;
              entry.calls++;
              try {
                if (signal.aborted) throw abortError();
                const result = await client.callTool(
                  { name: tool.name, arguments: args as Record<string, unknown> },
                  { timeout: REQUEST_TIMEOUT_MS, signal },
                );
                return outputText(result);
              } catch (error) {
                if (signal.aborted) {
                  if (error instanceof Error && error.name === "AbortError") throw error;
                  throw abortError();
                }
                if (error instanceof Error && error.name === "AbortError") throw error;
                return textResult("MCP 工具调用失败。", true);
              } finally {
                activeCalls.delete(shutdownController);
                entry.calls--;
                if (entry.retired && entry.calls === 0) entry.drain();
              }
            },
          }),
        );
      }
      if (entries.get(configuration.id) !== entry || entry.retired) return;
      registry.install(defineExtension({ name: extensionName, tools: installedTools }));
      statuses.set(configuration.id, {
        id: configuration.id,
        name: configuration.name,
        status: "connected",
        toolCount: installedTools.length,
        skippedToolCount,
        ...(skippedToolCount > 0
          ? { message: `${skippedToolCount} 个工具因名称或参数 Schema 不受支持而跳过。` }
          : {}),
      });
    } catch {
      disconnect(entry, "MCP Server 启动或工具发现失败，请检查命令、参数和服务配置。");
      if (entries.get(configuration.id) !== entry) retireEntry(entry);
    }
  }

  return {
    async sync(configurations: readonly McpServerConfiguration[]) {
      if (closed) return;
      const desired = new Map(
        configurations.map((configuration) => [configuration.id, configuration]),
      );
      for (const [id, entry] of entries) {
        if (desired.get(id) && JSON.stringify(desired.get(id)) === entry.key) continue;
        entries.delete(id);
        registry.uninstall({ name: entry.extensionName });
        statuses.delete(id);
        retireEntry(entry);
      }
      for (const id of statuses.keys()) {
        if (!desired.has(id)) statuses.delete(id);
      }
      const pending = configurations.filter((configuration) => {
        const current = entries.get(configuration.id);
        return !current || current.key !== JSON.stringify(configuration);
      });
      await Promise.all(
        pending.map((configuration) => connectServer(configuration, JSON.stringify(configuration))),
      );
    },
    statuses(): McpServerStatus[] {
      return [...statuses.values()].map((status) => ({ ...status }));
    },
    displayName(toolName: string): string | undefined {
      return names.get(toolName);
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      for (const [id, entry] of entries) {
        entries.delete(id);
        registry.uninstall({ name: entry.extensionName });
        retireEntry(entry);
      }
      for (const controller of activeCalls) controller.abort(abortError());
      const cleanup = Promise.all([...retired].map((entry) => closeEntry(entry)));
      closePromise = waitAtMost(cleanup, SHUTDOWN_TIMEOUT_MS);
      return closePromise;
    },
  };
}
