import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";

import App from "../../src/App";
import {
  runnerClient,
  type ConversationSnapshot,
  type InitializeResult,
} from "../../src/app/runner-client";

vi.mock("../../src/app/runner-client", () => ({
  runnerClient: {
    createBot: vi.fn<typeof runnerClient.createBot>(),
    createConversation: vi.fn<typeof runnerClient.createConversation>(),
    initialize: vi.fn<() => Promise<InitializeResult>>(),
    snapshot: vi.fn<(conversationId: number) => Promise<ConversationSnapshot>>(),
    submit:
      vi.fn<(conversationId: number, text: string, requestId: string) => Promise<{ id: number }>>(),
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
      model: { provider: "deepseek", modelId: "deepseek-chat" },
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
      model: { provider: "deepseek", modelId: "deepseek-chat" },
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

  expect(await screen.findByText(/正在发送消息/)).toBeTruthy();
  expect(runnerClient.submit).toHaveBeenCalledWith(41, "检查任务状态", expect.any(String));

  submission.resolve({ id: 73 });
  expect(await screen.findByText(/消息已发送/)).toBeTruthy();

  currentSnapshot = {
    ...initialSnapshot,
    messages: [{ id: 9, role: "assistant", text: "任务已完成。", truncated: false }],
    submissions: [{ id: 73, type: "input", status: "placed" }],
  };
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(
    within(screen.getByRole("region", { name: "聊天内容" })).getByText("任务已完成。"),
  ).toBeTruthy();

  const settledSnapshotCalls = vi.mocked(runnerClient.snapshot).mock.calls.length;
  view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(settledSnapshotCalls);
});

it("filters conversations and toggles the information panel", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  render(createElement(App));
  const search = await screen.findByRole("textbox", { name: "搜索会话" });
  fireEvent.change(search, { target: { value: "不存在" } });
  expect(screen.getByText("没有找到匹配的会话。")).toBeTruthy();
  fireEvent.change(search, { target: { value: "测试" } });
  expect(
    within(screen.getByRole("navigation", { name: "聊天" })).getByText("测试助手"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "收起智能体资料" }));
  expect(screen.queryByRole("complementary", { name: "智能体资料" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开智能体资料" }));
  expect(screen.getByRole("complementary", { name: "智能体资料" })).toBeTruthy();
});

it("creates a default DeepSeek assistant and opens a conversation on first use", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    bots: [],
    conversations: [],
  });
  vi.mocked(runnerClient.createBot).mockResolvedValue(initialState.bots[0]!);
  vi.mocked(runnerClient.createConversation).mockResolvedValue(initialState.conversations[0]!);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "开始聊天" }));
  await waitFor(() =>
    expect(runnerClient.createBot).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "deepseek-chat", tools: [] }),
    ),
  );
  expect(runnerClient.createConversation).toHaveBeenCalledWith("bot-1", "", "");
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement).disabled,
    ).toBe(false),
  );
});

it("does not send on IME confirmation or Shift+Enter", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  render(createElement(App));
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(input, { target: { value: "你好" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(runnerClient.submit).not.toHaveBeenCalled();
});

it("opens a visible conversation immediately after creating an assistant from the form", async () => {
  const bot = { ...initialState.bots[0]!, id: "bot-new", name: "资料整理" };
  const conversation = {
    ...initialState.conversations[0]!,
    id: 42,
    botId: bot.id,
    botName: bot.name,
  };
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.createBot).mockResolvedValue(bot);
  vi.mocked(runnerClient.createConversation).mockResolvedValue(conversation);
  vi.mocked(runnerClient.snapshot).mockImplementation(async (id) =>
    id === 42
      ? {
          ...initialSnapshot,
          conversation: {
            ...initialSnapshot.conversation,
            id: 42,
            botId: bot.id,
            botName: bot.name,
          },
        }
      : initialSnapshot,
  );
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "智能体" }));
  const dialog = await screen.findByRole("dialog", { name: "新建智能体" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot 名称" }), {
    target: { value: bot.name },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "创建智能体" }));
  await waitFor(() => expect(runnerClient.createConversation).toHaveBeenCalledWith(bot.id, "", ""));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建智能体" })).toBeNull());
  expect(
    await within(screen.getByRole("region", { name: "聊天内容" })).findByRole("heading", {
      name: bot.name,
    }),
  ).toBeTruthy();
  expect(within(screen.getByRole("navigation", { name: "聊天" })).getByText(bot.name)).toBeTruthy();
});

it("keeps the created assistant when opening its chat fails and retries without creating a duplicate", async () => {
  const bot = { ...initialState.bots[0]!, id: "bot-retry", name: "重试助手" };
  const conversation = {
    ...initialState.conversations[0]!,
    id: 43,
    botId: bot.id,
    botName: bot.name,
  };
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.createBot).mockResolvedValue(bot);
  vi.mocked(runnerClient.createConversation)
    .mockRejectedValueOnce(new Error("暂时无法打开聊天"))
    .mockResolvedValue(conversation);
  vi.mocked(runnerClient.snapshot).mockImplementation(async (id) =>
    id === 43
      ? {
          ...initialSnapshot,
          conversation: {
            ...initialSnapshot.conversation,
            id: 43,
            botId: bot.id,
            botName: bot.name,
          },
        }
      : initialSnapshot,
  );
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "智能体" }));
  const dialog = await screen.findByRole("dialog", { name: "新建智能体" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot 名称" }), {
    target: { value: bot.name },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "创建智能体" }));
  expect(await screen.findByText(/智能体已创建，但打开聊天失败/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "开始聊天" }));
  expect(
    await within(screen.getByRole("region", { name: "聊天内容" })).findByRole("heading", {
      name: bot.name,
    }),
  ).toBeTruthy();
  expect(runnerClient.createBot).toHaveBeenCalledTimes(1);
  expect(runnerClient.createConversation).toHaveBeenCalledTimes(2);
});
