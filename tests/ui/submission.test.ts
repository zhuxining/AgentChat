import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import App from "../../src/App";
import {
  runnerClient,
  type ConversationSnapshot,
  type InitializeResult,
} from "../../src/app/runner-client";
import { TooltipProvider } from "../../src/components/ui/tooltip";

vi.mock("../../src/app/runner-client", () => ({
  runnerClient: {
    runtimeStatus: vi.fn<typeof runnerClient.runtimeStatus>(),
    startRunner: vi.fn<typeof runnerClient.startRunner>(),
    updateBot: vi.fn<typeof runnerClient.updateBot>(),
    archiveBot: vi.fn<typeof runnerClient.archiveBot>(),
    reloadConfiguration: vi.fn<typeof runnerClient.reloadConfiguration>(),
    readConfiguration: vi.fn<typeof runnerClient.readConfiguration>(),
    saveConfiguration: vi.fn<typeof runnerClient.saveConfiguration>(),
    stopRunner: vi.fn<typeof runnerClient.stopRunner>(),
    restartRunner: vi.fn<typeof runnerClient.restartRunner>(),
    applyBotSettings: vi.fn<typeof runnerClient.applyBotSettings>(),
    providerRequest: vi.fn<typeof runnerClient.providerRequest>(),
    createBot: vi.fn<typeof runnerClient.createBot>(),
    createConversation: vi.fn<typeof runnerClient.createConversation>(),
    saveGoal: vi.fn<typeof runnerClient.saveGoal>(),
    setGoalStatus: vi.fn<typeof runnerClient.setGoalStatus>(),
    abort: vi.fn<typeof runnerClient.abort>(),
    abortSubmission: vi.fn<typeof runnerClient.abortSubmission>(),
    initialize: vi.fn<() => Promise<InitializeResult>>(),
    snapshot: vi.fn<(conversationId: number) => Promise<ConversationSnapshot>>(),
    submit:
      vi.fn<(conversationId: number, text: string, requestId: string) => Promise<{ id: number }>>(),
  },
}));

// happy-dom 不解析媒体查询，布局判断需要显式桩；默认按桌面宽度运行。
beforeEach(() => {
  vi.mocked(runnerClient.runtimeStatus).mockResolvedValue({
    status: "ready",
    path: "/test/node",
    version: "v24.0.0",
    source: "system",
    architecture: "arm64",
    detail: null,
  });
  vi.mocked(runnerClient.startRunner).mockResolvedValue(undefined);
  vi.mocked(runnerClient.providerRequest).mockResolvedValue({
    version: "v1",
    restartRequired: false,
    catalog: [],
    instances: [],
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
  providers: [{ name: "deepseek", models: ["deepseek-chat", "deepseek-reasoner"] }],
  apiKeyConfigured: false,
  runtimeVersion: "v22.19.0",
};

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const view = render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(TooltipProvider, null, createElement(App)),
    ),
  );
  return { ...view, queryClient };
}

// The list is always present in the shell; opening a Bot is the only way into a chat.
async function openBot(name: string | RegExp = /测试助手/) {
  fireEvent.click(await screen.findByRole("button", { name }));
  await screen.findByRole("region", { name: "聊天内容" });
}

async function openDetails() {
  // Desktop keeps the details pane open by default; below md it becomes a page.
  const pane = screen.queryByRole("complementary", { name: "Bot 详情" });
  if (pane) return pane;
  fireEvent.click(await screen.findByRole("button", { name: "查看 Bot 详情" }));
  return screen.findByRole("region", { name: "Bot 详情" });
}

async function openRunnerSettings() {
  fireEvent.click(await screen.findByRole("button", { name: "应用设置" }));
  fireEvent.click(await screen.findByRole("button", { name: "Runner" }));
  return screen.findByRole("region", { name: "设置" });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

it("shows pending input, clears the composer, refreshes replies, and stops polling when unmounted", async () => {
  let currentSnapshot = initialSnapshot;
  const submission = deferred<{ id: number }>();
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockImplementation(async () => currentSnapshot);
  vi.mocked(runnerClient.submit).mockReturnValue(submission.promise);
  const view = renderApp();
  await openBot();
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));

  fireEvent.change(input, { target: { value: "检查任务状态" } });
  const form = input.closest("form");
  if (!form) throw new Error("发送表单未渲染");
  fireEvent.submit(form);

  expect(await screen.findByText(/正在发送消息/)).toBeTruthy();
  expect(runnerClient.submit).toHaveBeenCalledWith(41, "检查任务状态", expect.any(String));

  submission.resolve({ id: 73 });
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));

  currentSnapshot = {
    ...initialSnapshot,
    messages: [{ id: 9, role: "assistant", text: "任务已完成。", truncated: false }],
    submissions: [{ id: 73, type: "input", status: "placed" }],
  };
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  const chat = within(screen.getByRole("region", { name: "聊天内容" }));
  const replyRow = chat.getByText("任务已完成。").closest('[data-slot="message-scroller-item"]');
  expect(replyRow?.classList.contains("animate-message-in")).toBe(true);

  const settledSnapshotCalls = vi.mocked(runnerClient.snapshot).mock.calls.length;
  view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(settledSnapshotCalls);
});

it("filters Bots and keeps the query while leaving and returning to the list", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    bots: [...initialState.bots, { ...initialState.bots[0]!, id: "bot-2", name: "写作助手" }],
  });
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  const search = await screen.findByRole("textbox", { name: "搜索 Bot" });
  fireEvent.change(search, { target: { value: "不存在" } });
  expect(screen.getByText("没有找到匹配的 Bot")).toBeTruthy();
  fireEvent.change(search, { target: { value: "写作" } });
  const nav = screen.getByRole("navigation", { name: "Bot 列表" });
  expect(within(nav).getByText("写作助手")).toBeTruthy();
  expect(within(nav).queryByText("测试助手")).toBeNull();
  await openBot(/写作助手/);
  expect(await screen.findByRole("region", { name: "聊天内容" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回 Bot 列表" }));
  expect((screen.getByRole("textbox", { name: "搜索 Bot" }) as HTMLInputElement).value).toBe(
    "写作",
  );
});

it("creates a Bot from the Runner template and opens its chat", async () => {
  const bot = { ...initialState.bots[0]!, id: "bot-new", name: "资料整理" };
  const conversation = {
    ...initialState.conversations[0]!,
    id: 42,
    botId: bot.id,
    botName: bot.name,
  };
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    bots: [],
    conversations: [],
  });
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
  renderApp();
  fireEvent.click(await screen.findByRole("button", { name: "新建 Bot" }));
  const page = await screen.findByRole("region", { name: "新建 Bot" });
  const form = within(page);
  fireEvent.change(form.getByLabelText("Bot 名称"), { target: { value: bot.name } });
  fireEvent.click(form.getByRole("button", { name: "创建 Bot" }));
  await waitFor(() =>
    expect(runnerClient.createBot).toHaveBeenCalledWith(
      expect.objectContaining({
        name: bot.name,
        provider: "deepseek",
        modelId: "deepseek-chat",
        tools: ["read"],
        instructions: "",
      }),
    ),
  );
  await waitFor(() => expect(runnerClient.createConversation).toHaveBeenCalledWith(bot.id, "", ""));
  expect(
    await within(screen.getByRole("region", { name: "聊天内容" })).findByRole("heading", {
      name: bot.name,
    }),
  ).toBeTruthy();
});

it("does not send on IME confirmation or Shift+Enter", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(input, { target: { value: "你好" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(runnerClient.submit).not.toHaveBeenCalled();
});

it("keeps the created Bot when opening its chat fails and retries without creating a duplicate", async () => {
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
  renderApp();
  fireEvent.click(await screen.findByRole("button", { name: "新建 Bot" }));
  const page = await screen.findByRole("region", { name: "新建 Bot" });
  fireEvent.change(within(page).getByLabelText("Bot 名称"), { target: { value: bot.name } });
  fireEvent.click(within(page).getByRole("button", { name: "创建 Bot" }));
  expect(await screen.findByText(/Bot 已创建，但打开聊天失败/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "开始新对话" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement).disabled,
    ).toBe(false),
  );
  expect(runnerClient.createBot).toHaveBeenCalledTimes(1);
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
  renderApp();
  await openBot();
  const details = await openDetails();
  fireEvent.click(within(details).getByRole("button", { name: "配置能力" }));
  const editor = within(await screen.findByRole("dialog", { name: "配置能力" }));
  fireEvent.click(editor.getByRole("checkbox", { name: "coding-tools" }));
  expect(editor.getByRole("checkbox", { name: /read/ }).getAttribute("aria-checked")).toBe("false");
  expect(editor.getByRole("checkbox", { name: /read/ }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(editor.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(runnerClient.updateBot).toHaveBeenCalledWith(
      "bot-1",
      expect.objectContaining({
        provider: "deepseek",
        modelId: "deepseek-chat",
        extensions: [],
        tools: [],
      }),
      "bot-config-v1",
    ),
  );
  const apply = await screen.findByRole("button", { name: "应用最新 Bot 设置" });
  expect(runnerClient.applyBotSettings).not.toHaveBeenCalled();
  fireEvent.click(apply);
  await waitFor(() => expect(runnerClient.applyBotSettings).toHaveBeenCalledWith(41));
});

it("preserves an unsaved work goal while the details pane is pushed away", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  const pane = within(await openDetails());
  fireEvent.change(pane.getByRole("textbox", { name: "工作目标" }), {
    target: { value: "保留目标草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "收起 Bot 详情" }));
  fireEvent.click(await screen.findByRole("button", { name: "展开 Bot 详情" }));
  expect(
    ((await screen.findByRole("textbox", { name: "工作目标" })) as HTMLTextAreaElement).value,
  ).toBe("保留目标草稿");
});

it("starts a fresh dialog draft when the same field is reopened", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  const details = await openDetails();
  fireEvent.click(within(details).getByRole("button", { name: "编辑指令" }));
  const dialog = within(await screen.findByRole("dialog", { name: "编辑指令" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "指令" }), {
    target: { value: "未保存的指令" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑指令" })).toBeNull());
  fireEvent.click(within(details).getByRole("button", { name: "编辑指令" }));
  const reopened = within(await screen.findByRole("dialog", { name: "编辑指令" }));
  expect((reopened.getByRole("textbox", { name: "指令" }) as HTMLTextAreaElement).value).toBe(
    "用简体中文回答。",
  );
});

it("opens settings as a standalone view and returns to the previous chat", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  expect(await screen.findByRole("textbox", { name: "发送消息" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "应用设置" }));
  const settings = await screen.findByRole("region", { name: "设置" });
  // The rail owns navigation back to the workspace instead of the Bot list staying visible.
  expect(within(settings).getByRole("navigation", { name: "设置分类" })).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "返回" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "设置" })).toBeNull());
  expect(await screen.findByRole("textbox", { name: "发送消息" })).toBeTruthy();
});

it("stops background polling with the Runner and reconnects without closing the UI", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.stopRunner).mockResolvedValue(undefined);
  vi.mocked(runnerClient.restartRunner).mockResolvedValue(undefined);
  renderApp();
  await openBot();
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  const settings = await openRunnerSettings();
  expect(within(settings).getByText(/关闭窗口或退出 UI 后，后台 Runner 继续运行/)).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "停止后台 Runner" }));
  await waitFor(() => expect(within(settings).getByText("后台已停止")).toBeTruthy());
  const calls = vi.mocked(runnerClient.snapshot).mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(calls);
  expect(runnerClient.initialize).toHaveBeenCalledTimes(1);
  fireEvent.click(within(settings).getByRole("button", { name: "启动并连接" }));
  await waitFor(() => expect(runnerClient.initialize).toHaveBeenCalledTimes(2));
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
  renderApp();
  const settings = await openRunnerSettings();
  fireEvent.click(within(settings).getByRole("button", { name: "重载配置" }));
  expect(await within(settings).findByText(/bots\/bot-1\/bot.json.*模型名称不可用/)).toBeTruthy();
  expect(within(settings).getByText(/需要重新启动 Runner 后生效/)).toBeTruthy();
  expect(within(settings).getByText(/无效的磁盘修改未生效/)).toBeTruthy();
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
  renderApp();
  const settings = await openRunnerSettings();
  const paths = within(settings).getByRole("combobox", { name: "配置文件路径" });
  expect(Array.from((paths as HTMLSelectElement).options, (option) => option.value)).toEqual(
    initialState.configuration.files,
  );
  fireEvent.click(within(settings).getByRole("button", { name: "读取配置" }));
  const textarea = await within(settings).findByRole("textbox", { name: "配置文件内容" });
  fireEvent.change(textarea, { target: { value: '{"name":"保留草稿"}' } });
  fireEvent.click(within(settings).getByRole("button", { name: "保存配置文件" }));
  expect(await within(settings).findByText("配置已被外部修改，请刷新后重试")).toBeTruthy();
  expect((textarea as HTMLTextAreaElement).value).toBe('{"name":"保留草稿"}');
  expect(runnerClient.saveConfiguration).toHaveBeenCalledWith(
    "runner.json",
    "disk-v1",
    '{"name":"保留草稿"}',
  );
  fireEvent.click(within(settings).getByRole("button", { name: "重新读取配置" }));
  await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe('{"name":"外部修改"}'));
  expect(within(settings).queryByText("配置已被外部修改，请刷新后重试")).toBeNull();
  fireEvent.change(textarea, { target: { value: '{"name":"新名称"}' } });
  fireEvent.click(within(settings).getByRole("button", { name: "保存配置文件" }));
  await waitFor(() =>
    expect(runnerClient.saveConfiguration).toHaveBeenLastCalledWith(
      "runner.json",
      "disk-v2",
      '{"name":"新名称"}',
    ),
  );
  expect(await within(settings).findByText(/内容版本：disk-v3/)).toBeTruthy();
});

it("archives using the Bot version captured by the detail view", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.archiveBot).mockRejectedValue(new Error("Bot 配置已变更，请重新读取"));
  renderApp();
  await openBot();
  const details = await openDetails();
  fireEvent.click(within(details).getByRole("button", { name: "归档 Bot…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "归档 Bot" }));
  fireEvent.click(dialog.getByRole("button", { name: "归档" }));
  await waitFor(() =>
    expect(runnerClient.archiveBot).toHaveBeenCalledWith("bot-1", "bot-config-v1"),
  );
  expect(await screen.findByText("Bot 配置已变更，请重新读取")).toBeTruthy();
});

it("renders every conversation of a Bot as one continuous timeline", async () => {
  const history: ConversationSnapshot = {
    ...initialSnapshot,
    conversation: { ...initialSnapshot.conversation, id: 40 },
    messages: [{ id: 1, role: "user", text: "上一段会话的消息", truncated: false }],
  };
  const live: ConversationSnapshot = {
    ...initialSnapshot,
    messages: [{ id: 2, role: "assistant", text: "这一段会话的回复", truncated: false }],
  };
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    conversations: [
      { ...initialState.conversations[0]!, id: 40, createdAt: 1 },
      { ...initialState.conversations[0]!, id: 41, createdAt: 2 },
    ],
  });
  vi.mocked(runnerClient.snapshot).mockImplementation(async (id) => (id === 40 ? history : live));
  renderApp();
  await openBot();
  const chat = within(await screen.findByRole("region", { name: "聊天内容" }));
  expect(await chat.findByText("上一段会话的消息")).toBeTruthy();
  expect(chat.getByText("这一段会话的回复")).toBeTruthy();
  expect(chat.getByText(/新会话/)).toBeTruthy();
});

it("renders Bot details when an older background Runner omits provider options", async () => {
  const legacy = { ...initialState };
  delete legacy.providers;
  vi.mocked(runnerClient.initialize).mockResolvedValue(legacy);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  const details = await openDetails();
  // Falls back to the Bot's current provider and model instead of crashing.
  expect(
    (within(details).getByRole("combobox", { name: "服务商" }) as HTMLSelectElement).value,
  ).toBe("deepseek");
  expect((within(details).getByRole("combobox", { name: "模型" }) as HTMLSelectElement).value).toBe(
    "deepseek-chat",
  );
});

it("renders the transcript as a message scroller log with a jump control", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  const chat = within(await screen.findByRole("region", { name: "聊天内容" }));
  expect(chat.getByRole("log")).toBeTruthy();
  expect(chat.getByRole("button", { name: "跳到最新消息" })).toBeTruthy();
});

it("falls back to a page stack below the desktop width", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  // The index page is the Bot list itself, and details become a page again.
  expect(await screen.findByRole("region", { name: "Bot 列表页" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /测试助手/ }));
  const chat = within(await screen.findByRole("region", { name: "聊天内容" }));
  fireEvent.click(chat.getByRole("button", { name: "查看 Bot 详情" }));
  expect(await screen.findByRole("region", { name: "Bot 详情" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回聊天" }));
  expect(await screen.findByRole("region", { name: "聊天内容" })).toBeTruthy();
});

it("keeps unsent input per Bot when switching Bots", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    bots: [...initialState.bots, { ...initialState.bots[0]!, id: "bot-2", name: "写作助手" }],
    conversations: [
      ...initialState.conversations,
      { ...initialState.conversations[0]!, id: 55, botId: "bot-2", botName: "写作助手" },
    ],
  });
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  await openBot();
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  fireEvent.change(input, { target: { value: "给测试助手的草稿" } });
  fireEvent.click(screen.getByRole("button", { name: /写作助手/ }));
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement).value).toBe(
      "",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /测试助手/ }));
  expect(
    ((await screen.findByRole("textbox", { name: "发送消息" })) as HTMLTextAreaElement).value,
  ).toBe("给测试助手的草稿");
});

function mockTwoBots() {
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    bots: [...initialState.bots, { ...initialState.bots[0]!, id: "bot-2", name: "写作助手" }],
    conversations: [
      ...initialState.conversations,
      { ...initialState.conversations[0]!, id: 55, botId: "bot-2", botName: "写作助手" },
    ],
  });
  vi.mocked(runnerClient.snapshot).mockImplementation(async (id) => ({
    ...initialSnapshot,
    conversation: {
      ...initialSnapshot.conversation,
      id,
      botId: id === 55 ? "bot-2" : "bot-1",
      botName: id === 55 ? "写作助手" : "测试助手",
    },
  }));
}

it("settles a submission against its original Bot while preserving another Bot's draft", async () => {
  mockTwoBots();
  const submission = deferred<{ id: number }>();
  vi.mocked(runnerClient.submit).mockReturnValue(submission.promise);
  renderApp();
  await openBot();
  const input = await screen.findByRole("textbox", { name: "发送消息" });
  fireEvent.change(input, { target: { value: "发给测试助手" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(runnerClient.submit).toHaveBeenCalledTimes(1));
  await openBot(/写作助手/);
  const other = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
  expect(other.disabled).toBe(false);
  fireEvent.change(other, { target: { value: "写作助手的新草稿" } });
  await act(async () => submission.resolve({ id: 90 }));
  await waitFor(() => expect(other.value).toBe("写作助手的新草稿"));
  expect(runnerClient.submit).toHaveBeenCalledWith(41, "发给测试助手", expect.any(String));
  await openBot();
  expect((screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement).value).toBe("");
});

it("retains an uncertain request across navigation and retries with the same requestId", async () => {
  mockTwoBots();
  vi.mocked(runnerClient.submit)
    .mockRejectedValueOnce(new Error("连接中断"))
    .mockResolvedValueOnce({ id: 90 });
  renderApp();
  await openBot();
  const input = screen.getByRole("textbox", { name: "发送消息" });
  fireEvent.change(input, { target: { value: "只接纳一次" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText(/接纳结果尚未确认/);
  const first = vi.mocked(runnerClient.submit).mock.calls[0];
  await openBot(/写作助手/);
  const other = screen.getByRole("textbox", { name: "发送消息" });
  fireEvent.change(other, { target: { value: "另一条输入" } });
  fireEvent.submit(other.closest("form")!);
  await screen.findByText(/上一条提交结果尚未确认/);
  expect(runnerClient.submit).toHaveBeenCalledTimes(1);
  await openBot();
  fireEvent.click(screen.getByRole("button", { name: "应用设置" }));
  fireEvent.click(await screen.findByRole("button", { name: "Runner" }));
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  await waitFor(() => expect(runnerClient.submit).toHaveBeenCalledTimes(2));
  expect(vi.mocked(runnerClient.submit).mock.calls[1]).toEqual(first);
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement).value).toBe(
      "",
    ),
  );
});

it("shares snapshots between the Bot list, live chat and history without duplicate requests", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  const { queryClient } = renderApp();
  await openBot();
  await screen.findByRole("textbox", { name: "发送消息" });
  expect(runnerClient.initialize).toHaveBeenCalledTimes(1);
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(1);
  expect(
    queryClient.getQueryCache().findAll({ queryKey: ["runner", "snapshot", 41] }),
  ).toHaveLength(1);
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .filter(
        (query) =>
          query.queryKey[0] === "bot-summary" || query.queryKey[0] === "conversation-timeline",
      ),
  ).toHaveLength(0);
});

it("discards old snapshots on restart and ignores late responses from the old Runner", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  const late = deferred<ConversationSnapshot>();
  vi.mocked(runnerClient.snapshot)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue({
      ...initialSnapshot,
      messages: [{ id: 2, role: "assistant", text: "重启后的回复", truncated: false }],
    });
  vi.mocked(runnerClient.restartRunner).mockResolvedValue(undefined);
  const { queryClient } = renderApp();
  await openBot();
  await waitFor(() => expect(runnerClient.snapshot).toHaveBeenCalledTimes(1));
  const settings = await openRunnerSettings();
  fireEvent.click(within(settings).getByRole("button", { name: "重新启动并连接" }));
  await waitFor(() => expect(runnerClient.initialize).toHaveBeenCalledTimes(2));
  await act(async () =>
    late.resolve({
      ...initialSnapshot,
      messages: [{ id: 1, role: "assistant", text: "旧 Runner 的迟到回复", truncated: false }],
    }),
  );
  expect(JSON.stringify(queryClient.getQueryData(["runner", "snapshot", 41]))).not.toContain(
    "旧 Runner 的迟到回复",
  );
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  const chat = within(await screen.findByRole("region", { name: "聊天内容" }));
  expect(await chat.findByText("重启后的回复")).toBeTruthy();
  expect(chat.queryByText("旧 Runner 的迟到回复")).toBeNull();
});

it("does not refresh a stopped Runner when an earlier submission is acknowledged late", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.stopRunner).mockResolvedValue(undefined);
  const submission = deferred<{ id: number }>();
  vi.mocked(runnerClient.submit).mockReturnValue(submission.promise);
  renderApp();
  await openBot();
  const input = screen.getByRole("textbox", { name: "发送消息" });
  fireEvent.change(input, { target: { value: "等待确认" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(runnerClient.submit).toHaveBeenCalledTimes(1));
  const settings = await openRunnerSettings();
  fireEvent.click(within(settings).getByRole("button", { name: "停止后台 Runner" }));
  await within(settings).findByText("后台已停止");
  const calls = vi.mocked(runnerClient.snapshot).mock.calls.length;
  await act(async () => submission.resolve({ id: 91 }));
  expect(runnerClient.snapshot).toHaveBeenCalledTimes(calls);
  expect(runnerClient.initialize).toHaveBeenCalledTimes(1);
});

it("ignores a Bot update from an earlier Runner generation", async () => {
  vi.mocked(runnerClient.initialize)
    .mockResolvedValueOnce(initialState)
    .mockResolvedValue({
      ...initialState,
      bots: [{ ...initialState.bots[0]!, name: "重启后的名称", configVersion: "v3" }],
    });
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.restartRunner).mockResolvedValue(undefined);
  const update = deferred<Awaited<ReturnType<typeof runnerClient.updateBot>>>();
  vi.mocked(runnerClient.updateBot).mockReturnValue(update.promise);
  const { queryClient } = renderApp();
  await openBot();
  const details = within(await openDetails());
  fireEvent.click(details.getByRole("button", { name: "编辑指令" }));
  const editor = within(await screen.findByRole("dialog", { name: "编辑指令" }));
  fireEvent.change(editor.getByRole("textbox", { name: "指令" }), { target: { value: "旧操作" } });
  fireEvent.click(editor.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(runnerClient.updateBot).toHaveBeenCalledTimes(1));
  fireEvent.click(editor.getByRole("button", { name: "Close" }));
  const settings = await openRunnerSettings();
  fireEvent.click(within(settings).getByRole("button", { name: "重新启动并连接" }));
  await waitFor(() => expect(runnerClient.initialize).toHaveBeenCalledTimes(2));
  await act(async () => update.resolve({ bot: initialState.bots[0]!, bots: initialState.bots }));
  const catalog = queryClient.getQueryData<InitializeResult>(["runner", "catalog"]);
  expect(catalog?.bots[0]?.name).toBe("重启后的名称");
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(
    await within(await screen.findByRole("region", { name: "聊天内容" })).findByRole("heading", {
      name: "重启后的名称",
    }),
  ).toBeTruthy();
});

it("keeps lifecycle controls pending when switching settings sections", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  const restart = deferred<void>();
  vi.mocked(runnerClient.restartRunner).mockReturnValue(restart.promise);
  renderApp();
  let settings = await openRunnerSettings();
  fireEvent.click(within(settings).getByRole("button", { name: "重新启动并连接" }));
  await waitFor(() => expect(runnerClient.restartRunner).toHaveBeenCalledTimes(1));
  fireEvent.click(within(settings).getByRole("button", { name: "模型与 Provider" }));
  fireEvent.click(screen.getByRole("button", { name: "Runner" }));
  settings = screen.getByRole("region", { name: "设置" });
  expect(
    (within(settings).getByRole("button", { name: "重新启动并连接" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (within(settings).getByRole("button", { name: "停止后台 Runner" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(within(settings).getByRole("button", { name: "停止后台 Runner" }));
  expect(runnerClient.stopRunner).not.toHaveBeenCalled();
  await act(async () => restart.resolve());
  await waitFor(() =>
    expect(
      (within(settings).getByRole("button", { name: "重新启动并连接" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});

it("keeps sending disabled until the accepted submission has finished refreshing", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  const refresh = deferred<ConversationSnapshot>();
  vi.mocked(runnerClient.snapshot)
    .mockResolvedValueOnce(initialSnapshot)
    .mockReturnValueOnce(refresh.promise);
  vi.mocked(runnerClient.submit).mockResolvedValue({ id: 92 });
  renderApp();
  await openBot();
  const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "第一条" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(input.value).toBe(""));
  expect(input.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => refresh.resolve(initialSnapshot));
  await waitFor(() => expect(input.disabled).toBe(false));
});

it("does not show a previous Bot's operation error after switching Bots", async () => {
  mockTwoBots();
  vi.mocked(runnerClient.updateBot).mockRejectedValue(new Error("测试助手的配置冲突"));
  renderApp();
  await openBot();
  const details = within(await openDetails());
  fireEvent.click(details.getByRole("button", { name: "编辑指令" }));
  const editor = within(await screen.findByRole("dialog", { name: "编辑指令" }));
  fireEvent.click(editor.getByRole("button", { name: "保存" }));
  await screen.findByText("测试助手的配置冲突");
  await openBot(/写作助手/);
  await waitFor(() => expect(screen.queryByText("测试助手的配置冲突")).toBeNull());
});

it("resumes reads after a failed stop and keeps a failed restart paused until retry", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  vi.mocked(runnerClient.stopRunner).mockRejectedValueOnce(new Error("停止失败"));
  vi.mocked(runnerClient.restartRunner)
    .mockRejectedValueOnce(new Error("重启失败"))
    .mockResolvedValueOnce(undefined);
  const { queryClient } = renderApp();
  await openBot();
  const settings = await openRunnerSettings();
  fireEvent.click(within(settings).getByRole("button", { name: "停止后台 Runner" }));
  await within(settings).findByText("停止失败");
  expect(queryClient.getQueryData<{ paused: boolean }>(["runner", "lifecycle"])?.paused).toBe(
    false,
  );
  fireEvent.click(within(settings).getByRole("button", { name: "重新启动并连接" }));
  await within(settings).findByText("重启失败");
  expect(queryClient.getQueryData<{ paused: boolean }>(["runner", "lifecycle"])?.paused).toBe(true);
  expect(queryClient.getQueryData(["runner", "snapshot", 41])).toBeUndefined();
  fireEvent.click(within(settings).getByRole("button", { name: "重新启动并连接" }));
  await waitFor(() => expect(runnerClient.initialize).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(queryClient.getQueryData<{ paused: boolean }>(["runner", "lifecycle"])?.paused).toBe(
      false,
    ),
  );
});

it("starts fresh UI and draft stores when the application is mounted again", async () => {
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  const first = renderApp();
  await openBot();
  fireEvent.change(screen.getByRole("textbox", { name: "发送消息" }), {
    target: { value: "上一窗口的草稿" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索 Bot" }), {
    target: { value: "上一窗口的搜索" },
  });
  first.unmount();
  renderApp();
  expect(
    ((await screen.findByRole("textbox", { name: "搜索 Bot" })) as HTMLInputElement).value,
  ).toBe("");
  await openBot();
  expect((screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement).value).toBe("");
});

it("keeps Bot content stable while the selected conversation snapshot loads", async () => {
  const bot = { ...initialState.bots[0]!, id: "bot-2", name: "写作助手" };
  const conversation = {
    ...initialState.conversations[0]!,
    id: 55,
    botId: bot.id,
    botName: bot.name,
    createdAt: 2,
  };
  const botASnapshot: ConversationSnapshot = {
    ...initialSnapshot,
    messages: [{ id: 1, role: "assistant", text: "测试助手已有回复", truncated: false }],
  };
  const botBSnapshot: ConversationSnapshot = {
    ...initialSnapshot,
    conversation: {
      ...initialSnapshot.conversation,
      id: conversation.id,
      botId: bot.id,
      botName: bot.name,
    },
    goal: { ...initialSnapshot.goal, description: "写作助手的工作目标", updatedAt: 1 },
    messages: [{ id: 2, role: "assistant", text: "写作助手已有回复", truncated: false }],
  };
  const pendingBotSnapshot = deferred<ConversationSnapshot>();
  vi.mocked(runnerClient.initialize).mockResolvedValue({
    ...initialState,
    bots: [...initialState.bots, bot],
    conversations: [...initialState.conversations, conversation],
  });
  vi.mocked(runnerClient.snapshot).mockImplementation(async (id) =>
    id === 41 ? botASnapshot : pendingBotSnapshot.promise,
  );
  renderApp();
  await openBot();
  const details = within(await openDetails());
  const goalA = await details.findByRole("textbox", { name: "工作目标" });
  fireEvent.change(goalA, { target: { value: "测试助手的未保存目标" } });
  const chat = within(screen.getByRole("region", { name: "聊天内容" }));
  expect(await chat.findByText("测试助手已有回复")).toBeTruthy();

  const botList = within(screen.getByRole("navigation", { name: "Bot 列表" }));
  fireEvent.click(botList.getByRole("button", { name: /写作助手/ }));
  await waitFor(() => expect(chat.getByRole("heading", { name: "写作助手" })).toBeTruthy());

  // The new Bot has no snapshot yet: loading, never an empty conversation.
  expect(chat.queryByText("开始这次对话")).toBeNull();
  expect(chat.getByRole("status", { name: "正在加载会话" })).toBeTruthy();
  expect(botList.getByText("正在加载最近对话…")).toBeTruthy();
  expect(details.getByText("当前对话")).toBeTruthy();
  expect(details.getByText("正在加载会话…")).toBeTruthy();

  pendingBotSnapshot.resolve(botBSnapshot);
  expect(await chat.findByText("写作助手已有回复")).toBeTruthy();
  expect(await botList.findByText("写作助手已有回复")).toBeTruthy();
  const botBGoal = await details.findByRole("textbox", { name: "工作目标" });
  expect((botBGoal as HTMLTextAreaElement).value).toBe("写作助手的工作目标");
  fireEvent.change(botBGoal, { target: { value: "写作助手的未保存目标" } });
  // Loading a snapshot must not replay the entrance animation for its history.
  const loadedRow = chat
    .getByText("写作助手已有回复")
    .closest('[data-slot="message-scroller-item"]');
  expect(loadedRow?.classList.contains("animate-message-in")).toBe(false);

  fireEvent.click(botList.getByRole("button", { name: /测试助手/ }));
  expect(await chat.findByText("测试助手已有回复")).toBeTruthy();
  expect(chat.queryByRole("status", { name: "正在加载会话" })).toBeNull();
  expect((details.getByRole("textbox", { name: "工作目标" }) as HTMLTextAreaElement).value).toBe(
    "测试助手的未保存目标",
  );

  fireEvent.click(botList.getByRole("button", { name: /写作助手/ }));
  expect(await chat.findByText("写作助手已有回复")).toBeTruthy();
  expect((details.getByRole("textbox", { name: "工作目标" }) as HTMLTextAreaElement).value).toBe(
    "写作助手的未保存目标",
  );
});

it("keeps the loaded conversation visible when a snapshot refresh fails", async () => {
  let failing = false;
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockImplementation(async () => {
    if (failing) throw new Error("Runner 连接已断开");
    return {
      ...initialSnapshot,
      messages: [{ id: 4, role: "assistant", text: "刷新前已加载的内容", truncated: false }],
    };
  });
  renderApp();
  await openBot();
  const chat = within(screen.getByRole("region", { name: "聊天内容" }));
  expect(await chat.findByText("刷新前已加载的内容")).toBeTruthy();

  failing = true;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  });
  expect(chat.getByText("刷新前已加载的内容")).toBeTruthy();
  expect(chat.queryByRole("status", { name: "正在加载会话" })).toBeNull();
  expect(await screen.findByRole("alert")).toBeTruthy();
});

it("keeps settings drafts while switching categories but clears them on leaving", async () => {
  vi.mocked(runnerClient.providerRequest).mockResolvedValue({
    version: "v1",
    restartRequired: false,
    catalog: [
      { type: "deepseek", name: "DeepSeek", authentication: ["apiKey"], modelCount: 0, apis: [] },
    ],
    instances: [
      {
        instance: {
          id: "deepseek",
          name: "DeepSeek",
          type: "deepseek",
          enabled: true,
          auth: {
            type: "apiKey",
            source: { type: "keyring", entry: "deepseek" },
            useEnvironment: true,
          },
          visibleModels: [],
          modelOverrides: {},
          customModels: [],
        },
        configured: false,
        status: "missing",
      },
    ],
  });
  vi.mocked(runnerClient.initialize).mockResolvedValue(initialState);
  vi.mocked(runnerClient.snapshot).mockResolvedValue(initialSnapshot);
  renderApp();
  fireEvent.click(await screen.findByRole("button", { name: "应用设置" }));
  const settings = within(await screen.findByRole("region", { name: "设置" }));
  const search = async () => (await settings.findByLabelText("API 密钥")) as HTMLInputElement;
  fireEvent.click(await settings.findByRole("button", { name: "编辑 DeepSeek" }));
  fireEvent.change(await search(), { target: { value: "draft-across-categories" } });

  fireEvent.click(settings.getByRole("button", { name: "Runner" }));
  expect(await settings.findByRole("region", { name: "后台运行状态" })).toBeTruthy();
  fireEvent.click(settings.getByRole("button", { name: "模型与 Provider" }));
  expect(await search()).toBeDefined();
  expect((await search()).value).toBe("draft-across-categories");

  fireEvent.click(settings.getByRole("button", { name: "返回" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "设置" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "应用设置" }));
  const reopened = within(await screen.findByRole("region", { name: "设置" }));
  fireEvent.click(reopened.getByRole("button", { name: "模型与 Provider" }));
  fireEvent.click(await reopened.findByRole("button", { name: "编辑 DeepSeek" }));
  expect(((await reopened.findByLabelText("API 密钥")) as HTMLInputElement).value).toBe("");
});
