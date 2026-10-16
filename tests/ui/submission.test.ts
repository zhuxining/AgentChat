import { afterEach, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import App from "../../src/App";
import { runnerClient, type ConversationSnapshot, type InitializeResult } from "../../src/app/runner-client";

vi.mock("../../src/app/runner-client", () => ({
  runnerClient: {
    initialize: vi.fn(),
    snapshot: vi.fn(),
    submit: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const initialSnapshot: ConversationSnapshot = {
  conversation: {
    id: 41,
    botId: "bot-1",
    botName: "测试助手",
    botRevision: 1,
    agent: {
      model: { provider: "openai", modelId: "gpt-5-mini" },
      thinkingLevel: "medium",
      instructions: "用简体中文回答。",
      cwd: "/tmp/agentchat-ui-test",
      extensions: ["agentchat-work-goal", "coding-tools"],
      tools: ["read"],
    },
  },
  goal: { description: "", status: "open", updatedAt: 0, completedAt: null },
  messages: [],
  hasMoreMessages: false,
  activeTasks: [],
  submissions: [],
  configurationErrors: { missingExtensions: [], missingTools: [] },
  apiKeyConfigured: false,
};

const initialState: InitializeResult = {
  bots: [
    {
      id: "bot-1",
      name: "测试助手",
      model: { provider: "openai", modelId: "gpt-5-mini" },
      thinkingLevel: "medium",
      instructions: "用简体中文回答。",
      cwd: "/tmp/agentchat-ui-test",
      extensions: ["coding-tools"],
      tools: ["read"],
      revision: 1,
      archived: false,
    },
  ],
  conversations: [{ id: 41, botId: "bot-1", botName: "测试助手", botRevision: 1, createdAt: 1 }],
  capabilities: {
    extensions: ["coding-tools"],
    tools: [{ name: "read", extension: "coding-tools" }],
  },
  apiKeyConfigured: false,
  runtimeVersion: "v22.19.0",
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

it("shows pending versus accepted input, refreshes replies, and stops polling when unmounted", async () => {
  let currentSnapshot = initialSnapshot;
  const submission = deferred<{ id: number }>();
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockImplementation(async () => currentSnapshot);
  vi.mocked(runnerClient.submit).mockReturnValue(submission.promise);

  const view = render(createElement(App));
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));

  fireEvent.change(input, { target: { value: "检查任务状态" } });
  const form = input.closest("form");
  if (!form) throw new Error("发送表单未渲染");
  fireEvent.submit(form);

  expect(await screen.findByText(/正在等待 Runner 确认接纳/)).toBeTruthy();
  expect(runnerClient.submit).toHaveBeenCalledWith(41, "检查任务状态", expect.any(String));

  submission.resolve({ id: 73 });
  expect(await screen.findByText(/Runner 已接纳输入 #73/)).toBeTruthy();

  currentSnapshot = {
    ...initialSnapshot,
    messages: [{ id: 9, role: "assistant", text: "任务已完成。", truncated: false }],
    submissions: [{ id: 73, type: "input", status: "placed" }],
  };
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(screen.getByText("任务已完成。")).toBeTruthy();

  const settledSnapshotCalls = vi.mocked(runnerClient.snapshot).mock.calls.length;
  view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(settledSnapshotCalls);
});
