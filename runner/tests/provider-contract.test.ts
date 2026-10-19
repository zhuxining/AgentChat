import { describe, expect, it } from "vite-plus/test";

// 契约测试：Runner 侧 ProviderRequest 解析与 contracts/providers.ts 的
// ProviderRequest 判别联合、Rust 侧 RunnerRequest::validate 的 action 白名单
// 必须保持一致；漂移会表现为前后端对同一请求的接受度不同。
import type { ProviderRequest } from "../../contracts/providers.js";

const contractActions = [
  "list",
  "save",
  "remove",
  "test",
  "writeCredential",
  "deleteCredential",
  "login",
  "loginStatus",
  "loginRespond",
  "cancelLogin",
  "logout",
  "refreshModels",
] as const;

describe("provider request contract", () => {
  it("every discriminated action survives a JSON round trip", () => {
    const samples: ProviderRequest[] = [
      { action: "list" },
      { action: "list", instanceId: "i", type: "t", search: "s" },
      { action: "remove", expectedVersion: "v1", instanceId: "i" },
      { action: "test", expectedVersion: "v1", instanceId: "i", modelId: "m" },
      { action: "writeCredential", instanceId: "i", value: "key" },
      { action: "deleteCredential", instanceId: "i" },
      { action: "login", instanceId: "i" },
      { action: "loginStatus", loginId: "l" },
      { action: "loginRespond", loginId: "l", value: "code" },
      { action: "cancelLogin", loginId: "l" },
      { action: "logout", instanceId: "i" },
      { action: "refreshModels", instanceId: "i" },
    ];
    for (const sample of samples) {
      const roundTripped = JSON.parse(JSON.stringify(sample)) as ProviderRequest;
      expect(roundTripped.action).toBe(sample.action);
      expect(contractActions).toContain(roundTripped.action);
    }
  });

  it("the contract action set matches the runner field table exactly", async () => {
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
    expect(Object.keys(fields).sort()).toEqual([...contractActions].sort());
  });
});
