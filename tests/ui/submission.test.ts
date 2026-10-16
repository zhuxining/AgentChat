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
    updateBot: vi.fn<typeof runnerClient.updateBot>(),
    archiveBot: vi.fn<typeof runnerClient.archiveBot>(),
    reloadConfiguration: vi.fn<typeof runnerClient.reloadConfiguration>(),
    readConfiguration: vi.fn<typeof runnerClient.readConfiguration>(),
    saveConfiguration: vi.fn<typeof runnerClient.saveConfiguration>(),
    stopRunner: vi.fn<typeof runnerClient.stopRunner>(),
    restartRunner: vi.fn<typeof runnerClient.restartRunner>(),
    applyBotSettings: vi.fn<typeof runnerClient.applyBotSettings>(),
    setProviderCredential: vi.fn<typeof runnerClient.setProviderCredential>(),
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
    botConfigVersion: "bot-config-v1",
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
      archived: false,
      configVersion: "bot-config-v1",
    },
  ],
  botDefaults: {
    provider: "deepseek",
    modelId: "deepseek-chat",
    thinkingLevel: "medium",
    instructions: "",
    cwd: "",
    extensions: ["coding-tools"],
    tools: ["read"],
  },
  configuration: {
    errors: [],
    restartRequired: false,
    ready: true,
    dataDir: "/tmp/agentchat-ui-test",
    files: ["runner.json", "bots/bot-1/bot.json"],
  },
  conversations: [
    {
      id: 41,
      botId: "bot-1",
      botName: "测试助手",
      botConfigVersion: "bot-config-v1",
      createdAt: 1,
    },
  ],
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
      expect.objectContaining({
        provider: "deepseek",
        modelId: "deepseek-chat",
        tools: ["read"],
        instructions: "",
      }),
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

it("keeps tool selection consistent while editing and applies settings only on request", async () => {
  let snapshot = initialSnapshot;
  const updated = {
    ...initialState.bots[0]!,
    model: { provider: "deepseek", modelId: "deepseek-reasoner" },
    extensions: [],
    tools: [],
    configVersion: "bot-config-v2",
  };
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockImplementation(async () => snapshot);
  vi.mocked(runnerClient.updateBot).mockResolvedValue({ bot: updated, bots: [updated] });
  vi.mocked(runnerClient.applyBotSettings).mockImplementation(async () => {
    snapshot = {
      ...initialSnapshot,
      conversation: {
        ...initialSnapshot.conversation,
        botConfigVersion: "bot-config-v2",
        agent: {
          ...initialSnapshot.conversation.agent,
          model: updated.model,
          extensions: [],
          tools: [],
        },
      },
    };
    return { botConfigVersion: "bot-config-v2" };
  });
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
  const dialog = await screen.findByRole("dialog", { name: "编辑智能体" });
  const editor = within(dialog);
  fireEvent.click(editor.getByRole("checkbox", { name: "coding-tools" }));
  expect((editor.getByRole("checkbox", { name: /read/ }) as HTMLInputElement).checked).toBe(false);
  expect((editor.getByRole("checkbox", { name: /read/ }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(editor.getByRole("textbox", { name: "模型 ID" }), {
    target: { value: "deepseek-reasoner" },
  });
  fireEvent.click(editor.getByRole("button", { name: "保存智能体" }));
  await waitFor(() =>
    expect(runnerClient.updateBot).toHaveBeenCalledWith(
      "bot-1",
      expect.objectContaining({
        provider: "deepseek",
        modelId: "deepseek-reasoner",
        extensions: [],
        tools: [],
      }),
      "bot-config-v1",
    ),
  );
  const apply = await screen.findByRole("button", { name: "应用最新智能体设置" });
  expect(runnerClient.applyBotSettings).not.toHaveBeenCalled();
  fireEvent.click(apply);
  await waitFor(() => expect(runnerClient.applyBotSettings).toHaveBeenCalledWith(41));
  expect(
    await within(screen.getByRole("complementary", { name: "智能体资料" })).findByText(
      "deepseek-reasoner",
    ),
  ).toBeTruthy();
});

it("clears the credential draft after saving and when closing settings", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.setProviderCredential).mockResolvedValue({
    configured: true,
    runnerUpdated: true,
  });
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "设置" }));
  let dialog = await screen.findByRole("dialog", { name: "设置" });
  fireEvent.change(within(dialog).getByLabelText("DeepSeek API Key"), {
    target: { value: "test-only-credential" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "安全保存" }));
  await waitFor(() =>
    expect((within(dialog).getByLabelText("DeepSeek API Key") as HTMLInputElement).value).toBe(""),
  );
  expect(runnerClient.setProviderCredential).toHaveBeenCalledWith("test-only-credential");
  fireEvent.change(within(dialog).getByLabelText("DeepSeek API Key"), {
    target: { value: "unsaved-test-value" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  dialog = await screen.findByRole("dialog", { name: "设置" });
  expect((within(dialog).getByLabelText("DeepSeek API Key") as HTMLInputElement).value).toBe("");
});

it("preserves an unsaved work goal when the inspector is collapsed", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  render(createElement(App));
  const goal = await screen.findByRole("textbox", { name: "工作目标" });
  fireEvent.change(goal, { target: { value: "保留目标草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "收起智能体资料" }));
  fireEvent.click(screen.getByRole("button", { name: "展开智能体资料" }));
  expect((screen.getByRole("textbox", { name: "工作目标" }) as HTMLTextAreaElement).value).toBe(
    "保留目标草稿",
  );
});

it("starts a fresh editor draft when the same assistant is reopened immediately", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  render(createElement(App));
  const edit = await screen.findByRole("button", { name: "编辑" });
  fireEvent.click(edit);
  const dialog = await screen.findByRole("dialog", { name: "编辑智能体" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Bot 名称" }), {
    target: { value: "未保存的名称" },
  });
  // Reopen before the dialog can unmount, as happens during its close animation.
  act(() => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(edit);
  });
  const reopened = await screen.findByRole("dialog", { name: "编辑智能体" });
  expect(
    (within(reopened).getByRole("textbox", { name: "Bot 名称" }) as HTMLInputElement).value,
  ).toBe("测试助手");
});

it("uses the Runner creation template for form defaults and first-chat creation", async () => {
  const botDefaults = {
    ...initialState.botDefaults,
    cwd: "",
    provider: "my-deepseek",
    modelId: "deepseek-reasoner",
    instructions: "来自 Runner 的指令",
    thinkingLevel: "high" as const,
    extensions: [],
    tools: [],
  };
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    botDefaults,
    bots: [],
    conversations: [],
  });
  vi.mocked(runnerClient.createBot).mockResolvedValue(initialState.bots[0]!);
  vi.mocked(runnerClient.createConversation).mockResolvedValue(initialState.conversations[0]!);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "智能体" }));
  const dialog = within(await screen.findByRole("dialog", { name: "新建智能体" }));
  expect((dialog.getByLabelText("Provider 配置名称") as HTMLInputElement).value).toBe(
    "my-deepseek",
  );
  expect((dialog.getByLabelText("模型 ID") as HTMLInputElement).value).toBe("deepseek-reasoner");
  expect((dialog.getByLabelText("指令") as HTMLTextAreaElement).value).toBe("来自 Runner 的指令");
  expect((dialog.getByRole("checkbox", { name: "coding-tools" }) as HTMLInputElement).checked).toBe(
    false,
  );
  fireEvent.click(dialog.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建智能体" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "开始聊天" }));
  await waitFor(() =>
    expect(runnerClient.createBot).toHaveBeenCalledWith({ ...botDefaults, name: "幕僚长" }),
  );
});

it("stops background polling with the Runner and reconnects without closing the UI", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.stopRunner).mockResolvedValue(undefined);
  vi.mocked(runnerClient.restartRunner).mockResolvedValue(undefined);
  render(createElement(App));
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  const dialog = within(await screen.findByRole("dialog", { name: "设置" }));
  expect(dialog.getByText(/关闭窗口或退出 UI 后，后台 Runner 继续运行/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "停止后台 Runner" }));
  await waitFor(() => expect(dialog.getByText("后台已停止")).toBeTruthy());
  expect(dialog.getByText("Runner 已停止")).toBeTruthy();
  const calls = vi.mocked(runnerClient.snapshot).mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(calls);
  expect((input as HTMLTextAreaElement).disabled).toBe(true);
  expect(runnerClient.initialize).toHaveBeenCalledTimes(1);
  fireEvent.click(dialog.getByRole("button", { name: "启动并连接" }));
  await waitFor(() => expect(runnerClient.initialize).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  expect(runnerClient.restartRunner).toHaveBeenCalledTimes(1);
});

it("displays reload diagnostics and resource changes requiring a restart", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.reloadConfiguration).mockResolvedValue({
    ...initialState,
    configuration: {
      ...initialState.configuration,
      restartRequired: true,
      errors: [{ path: "bots/bot-1/bot.json", message: "模型名称不可用", botId: "bot-1" }],
    },
  });
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "设置" }));
  const dialog = within(await screen.findByRole("dialog", { name: "设置" }));
  fireEvent.click(dialog.getByRole("button", { name: "重载配置" }));
  expect(await dialog.findByText(/bots\/bot-1\/bot.json.*模型名称不可用/)).toBeTruthy();
  expect(dialog.getByText(/需要重新启动 Runner 后生效/)).toBeTruthy();
  expect(dialog.getByText(/无效的磁盘修改未生效/)).toBeTruthy();
  expect(runnerClient.reloadConfiguration).toHaveBeenCalledTimes(1);
});

it("preserves a raw config draft on conflict and saves with the freshly read version", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.readConfiguration)
    .mockResolvedValueOnce({ path: "runner.json", version: "disk-v1", content: '{"name":"本机"}' })
    .mockResolvedValueOnce({
      path: "runner.json",
      version: "disk-v2",
      content: '{"name":"外部修改"}',
    })
    .mockResolvedValueOnce({
      path: "runner.json",
      version: "disk-v3",
      content: '{"name":"新名称"}',
    });
  vi.mocked(runnerClient.saveConfiguration)
    .mockRejectedValueOnce(new Error("配置已被外部修改，请刷新后重试"))
    .mockResolvedValueOnce({ saved: true });
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "设置" }));
  const dialog = within(await screen.findByRole("dialog", { name: "设置" }));
  const paths = dialog.getByRole("combobox", { name: "配置文件路径" });
  expect(Array.from((paths as HTMLSelectElement).options, (option) => option.value)).toEqual(
    initialState.configuration.files,
  );
  fireEvent.click(dialog.getByRole("button", { name: "读取配置" }));
  const textarea = await dialog.findByRole("textbox", { name: "配置文件内容" });
  fireEvent.change(textarea, { target: { value: '{"name":"保留草稿"}' } });
  fireEvent.click(dialog.getByRole("button", { name: "保存配置文件" }));
  expect(await dialog.findByText("配置已被外部修改，请刷新后重试")).toBeTruthy();
  expect((textarea as HTMLTextAreaElement).value).toBe('{"name":"保留草稿"}');
  expect(runnerClient.saveConfiguration).toHaveBeenCalledWith(
    "runner.json",
    "disk-v1",
    '{"name":"保留草稿"}',
  );
  fireEvent.click(dialog.getByRole("button", { name: "重新读取配置" }));
  await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe('{"name":"外部修改"}'));
  fireEvent.change(textarea, { target: { value: '{"name":"新名称"}' } });
  fireEvent.click(dialog.getByRole("button", { name: "保存配置文件" }));
  await waitFor(() =>
    expect(runnerClient.saveConfiguration).toHaveBeenLastCalledWith(
      "runner.json",
      "disk-v2",
      '{"name":"新名称"}',
    ),
  );
  expect(await dialog.findByText(/内容版本：disk-v3/)).toBeTruthy();
});

it("archives using the Bot version captured by the editor", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.archiveBot).mockRejectedValue(new Error("智能体配置已变更，请重新读取"));
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
  const dialog = within(await screen.findByRole("dialog", { name: "编辑智能体" }));
  fireEvent.click(dialog.getByRole("button", { name: "归档智能体" }));
  await waitFor(() =>
    expect(runnerClient.archiveBot).toHaveBeenCalledWith("bot-1", "bot-config-v1"),
  );
  expect(await dialog.findByText("智能体配置已变更，请重新读取")).toBeTruthy();
});
