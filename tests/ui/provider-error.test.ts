import { describe, expect, it } from "vite-plus/test";

import { providerError } from "@/features/settings/use-providers";

describe("providerError", () => {
  it("passes Runner business error messages through unchanged", () => {
    expect(providerError(new Error("接入实例不存在"))).toBe("接入实例不存在");
    expect(providerError("配置已被修改，请刷新后重试")).toBe("配置已被修改，请刷新后重试");
  });

  it("maps Runner-unavailable transport errors to an actionable message", () => {
    expect(providerError(new Error("runner unavailable"))).toBe("Runner 未运行，请先启动或重连。");
  });

  it("maps timeout transport errors to an actionable message", () => {
    expect(providerError(new Error("request timed out"))).toBe(
      "操作超时，请检查 Runner 状态后重试。",
    );
  });

  it("falls back to a generic message for non-error values", () => {
    expect(providerError(undefined)).toBe("供应商操作失败，请重试。");
    expect(providerError(null)).toBe("供应商操作失败，请重试。");
    expect(providerError(42)).toBe("供应商操作失败，请重试。");
  });
});
