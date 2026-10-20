import { describe, expect, it } from "vite-plus/test";

import { createAuthStatus } from "../src/harness/auth-status.js";

describe("display authentication cache", () => {
  it("expires a cached result after 30 seconds and shares the refresh", async () => {
    let now = 0;
    let reads = 0;
    const status = createAuthStatus(
      async () => {
        reads++;
        return reads === 1;
      },
      () => "revision",
      () => now,
    );
    expect(await status("provider")).toBe(true);
    now = 29_999;
    expect(await status("provider")).toBe(true);
    expect(reads).toBe(1);
    now = 30_000;
    expect(await Promise.all([status("provider"), status("provider")])).toEqual([false, false]);
    expect(reads).toBe(2);
  });

  it("does not reuse an in-flight result from before credential invalidation", async () => {
    let revision = "old";
    let resolveOld: (value: boolean) => void = () => {};
    let reads = 0;
    const status = createAuthStatus(
      () => {
        reads++;
        return revision === "old"
          ? new Promise<boolean>((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve(false);
      },
      () => revision,
    );
    const old = status("provider");
    await Promise.resolve();
    revision = "new";
    expect(await status("provider")).toBe(false);
    resolveOld(true);
    expect(await old).toBe(false);
    expect(await status("provider")).toBe(false);
    expect(reads).toBe(2);
  });

  it("does not retain rejected checks and does not authenticate an absent provider", async () => {
    let reads = 0;
    const status = createAuthStatus(
      async () => {
        if (++reads === 1) throw new Error("synthetic failure");
        return true;
      },
      () => "revision",
    );
    await expect(status("provider")).rejects.toThrow("synthetic failure");
    expect(await status("provider")).toBe(true);
    expect(await status(undefined)).toBe(false);
    expect(reads).toBe(2);
  });
});
