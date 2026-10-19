import { existsSync } from "node:fs";

import type { Credential } from "@earendil-works/pi-ai";

import type { CredentialSource } from "../../../contracts/providers.js";

export interface NativeAdapter {
  readCredential(source: CredentialSource): Promise<Credential | null>;
  writeCredential(source: CredentialSource, credential: Credential): Promise<void>;
  deleteCredential(source: CredentialSource): Promise<void>;
  env(name: string): Promise<string | null>;
  fileExists(path: string): Promise<boolean>;
}
/** Safe default for isolated tests and stand-alone Runner: never opens a credential file. */
export function localNativeAdapter(environment: NodeJS.ProcessEnv = process.env): NativeAdapter {
  const values = new Map<string, Credential>();
  return {
    async readCredential(source) {
      if (source.type === "env") {
        const key = environment[source.variable];
        return key ? { type: "api_key", key } : null;
      }
      return values.get(JSON.stringify(source)) ?? null;
    },
    async writeCredential(source, credential) {
      if (source.type === "env") throw new Error("环境变量来源不可写");
      values.set(JSON.stringify(source), credential);
    },
    async deleteCredential(source) {
      values.delete(JSON.stringify(source));
    },
    async env(name) {
      return environment[name] ?? null;
    },
    async fileExists(path) {
      return existsSync(path);
    },
  };
}

/** Installs the only stdin reader before startup; native replies bypass queued app requests. */
export function createNativeStdio() {
  const maxBytes = 1_048_576;
  let buffered = "";
  let sequence = 0;
  let ended = false;
  let receiver: ((line: string) => void) | undefined;
  let onEnd: (() => void) | undefined;
  let protocolError: ((reason: string) => void) | undefined;
  const backlog: string[] = [];
  let earlyError: string | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(reason: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function rejectAll() {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("宿主连接已断开"));
    }
    pending.clear();
  }
  function invalid(reason: string) {
    rejectAll();
    earlyError = reason;
    process.stdin.pause();
    protocolError?.(reason);
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffered += chunk;
    let index: number;
    while ((index = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, index).replace(/\r$/, "");
      buffered = buffered.slice(index + 1);
      if (Buffer.byteLength(line) + 1 > maxBytes) {
        invalid("Runner protocol message exceeded the byte limit");
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        invalid("Runner received malformed JSON");
        return;
      }
      if (value && typeof value === "object" && "nativeId" in value) {
        const record = value as Record<string, unknown>;
        if (
          typeof record.nativeId !== "number" ||
          !Number.isSafeInteger(record.nativeId) ||
          record.nativeId <= 0 ||
          typeof record.ok !== "boolean" ||
          (record.ok === true
            ? !Object.hasOwn(record, "result") || Object.hasOwn(record, "error")
            : typeof record.error !== "string" || Object.hasOwn(record, "result")) ||
          Object.keys(record).some((key) => !["nativeId", "ok", "result", "error"].includes(key))
        ) {
          invalid("Runner native response ID is invalid");
          return;
        }
        const request = pending.get(record.nativeId);
        if (!request) continue;
        pending.delete(record.nativeId);
        clearTimeout(request.timer);
        if (record.ok === true) request.resolve(record.result);
        else request.reject(new Error("宿主凭据操作失败"));
      } else if (receiver) receiver(line);
      else {
        if (backlog.length >= 128) {
          invalid("Runner startup request queue exceeded the limit");
          return;
        }
        backlog.push(line);
      }
    }
    if (Buffer.byteLength(buffered) > maxBytes)
      invalid("Runner protocol message exceeded the byte limit");
  });
  process.stdin.on("end", () => {
    ended = true;
    rejectAll();
    if (buffered) invalid("Runner input ended with an incomplete protocol message");
    else onEnd?.();
  });
  async function request(method: string, params: unknown): Promise<unknown> {
    if (ended || earlyError) throw new Error("宿主连接已断开");
    if (pending.size >= 64) throw new Error("宿主请求队列已满");
    const nativeId = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(nativeId);
        reject(new Error("宿主凭据操作超时"));
      }, 15_000);
      pending.set(nativeId, { resolve, reject, timer });
      process.stdout.write(`${JSON.stringify({ nativeId, method, params })}\n`, (error) => {
        if (error) {
          pending.delete(nativeId);
          clearTimeout(timer);
          reject(new Error("宿主连接写入失败"));
        }
      });
    });
  }
  const adapter: NativeAdapter = {
    async readCredential(source) {
      const value = await request("readCredential", { source });
      if (value === null) return null;
      if (!value || typeof value !== "object" || !("type" in value))
        throw new Error("宿主凭据格式无效");
      if (value.type === "api_key" && (!("key" in value) || typeof value.key === "string"))
        return value as Credential;
      if (
        value.type === "oauth" &&
        "access" in value &&
        typeof value.access === "string" &&
        "refresh" in value &&
        typeof value.refresh === "string" &&
        "expires" in value &&
        typeof value.expires === "number"
      )
        return value as Credential;
      throw new Error("宿主凭据格式无效");
    },
    async writeCredential(source, credential) {
      await request("writeCredential", { source, credential });
    },
    async deleteCredential(source) {
      await request("deleteCredential", { source });
    },
    async env(name) {
      const value = await request("env", { name });
      if (value !== null && typeof value !== "string") throw new Error("环境读取格式无效");
      return value;
    },
    async fileExists(path) {
      const value = await request("fileExists", { path });
      if (typeof value !== "boolean") throw new Error("文件状态格式无效");
      return value;
    },
  };
  return {
    adapter,
    attach(line: (line: string) => void, end: () => void, error: (reason: string) => void) {
      receiver = line;
      onEnd = end;
      protocolError = error;
      if (earlyError) {
        error(earlyError);
        return;
      }
      for (const item of backlog.splice(0)) line(item);
      if (ended && !buffered) end();
    },
  };
}
export type NativeStdio = ReturnType<typeof createNativeStdio>;
