import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const memoryMock = vi.hoisted(() => ({
  data: {
    botId: "bot-1",
    content: "旧记忆",
    revision: 7,
    source: "user" as "user" | null,
    updatedAt: 1,
  },
  failure: "",
  saveCalls: [] as { expectedRevision: number; content: string }[],
}));

vi.mock("../../src/features/bots/use-bot-memory", async () => {
  const { useState } = await import("react");
  return {
    useBotMemory: () => {
      const [operationError, setOperationError] = useState("");
      return {
        data: memoryMock.data,
        isPending: false,
        isFetching: false,
        isError: false,
        error: new Error("unused"),
        busy: false,
        runnerPaused: false,
        operationError,
        clearOperationError: () => setOperationError(""),
        refetch: async () => ({ data: memoryMock.data }),
        save: async (expectedRevision: number, content: string) => {
          memoryMock.saveCalls.push({ expectedRevision, content });
          if (memoryMock.failure) {
            setOperationError(memoryMock.failure);
            return null;
          }
          const saved = {
            ...memoryMock.data,
            content,
            revision: expectedRevision + 1,
            source: "user" as const,
            updatedAt: 2,
          };
          memoryMock.data = saved;
          return { memory: saved, redacted: false };
        },
      };
    },
  };
});

import { BotMemorySection } from "../../src/features/bots/bot-details-view";

beforeEach(() => {
  memoryMock.data = {
    botId: "bot-1",
    content: "旧记忆",
    revision: 7,
    source: "user",
    updatedAt: 1,
  };
  memoryMock.failure = "";
  memoryMock.saveCalls = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps a conflicting draft visible and lets the user load the newest revision", async () => {
  render(createElement(BotMemorySection, { botId: "bot-1" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑记忆" }));
  const editor = await screen.findByRole("textbox", { name: "Bot 记忆内容" });
  fireEvent.change(editor, { target: { value: "我的未保存草稿" } });
  memoryMock.failure = "Bot 记忆已被其他编辑更新，请重新读取后再保存。";
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Bot 记忆内容" })).toHaveProperty(
    "value",
    "我的未保存草稿",
  );
  expect(memoryMock.saveCalls).toEqual([{ expectedRevision: 7, content: "我的未保存草稿" }]);

  memoryMock.data = {
    ...memoryMock.data,
    content: "另一编辑已保存",
    revision: 8,
  };
  fireEvent.click(await screen.findByRole("button", { name: "放弃草稿并载入最新版本" }));

  expect(await screen.findByDisplayValue("另一编辑已保存")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clears the saved Bot memory at its current revision", async () => {
  render(createElement(BotMemorySection, { botId: "bot-1" }));
  fireEvent.click(screen.getByRole("button", { name: "清空记忆…" }));
  fireEvent.click(await screen.findByRole("button", { name: "清空" }));

  expect(memoryMock.saveCalls).toEqual([{ expectedRevision: 7, content: "" }]);
  expect((await screen.findByRole("status")).textContent).toContain("Bot 记忆已清空。");
});
