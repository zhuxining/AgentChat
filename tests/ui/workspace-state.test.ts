import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  runnerClient,
  type ConversationSnapshot,
  type InitializeResult,
} from "../../src/app/runner-client";
import { runnerKeys, useConversationSnapshot } from "../../src/app/runner-queries";
import { WorkspaceProvider } from "../../src/app/workspace-provider";
import { WorkspaceUiProvider, useWorkspaceUi } from "../../src/app/workspace-ui";
import { useChatActions } from "../../src/features/chat/use-chat-actions";
import { useRunnerSettings } from "../../src/features/settings/use-runner-actions";

vi.mock("../../src/app/runner-client", () => ({
  runnerClient: {
    submit: vi.fn<typeof runnerClient.submit>(),
    snapshot: vi.fn<typeof runnerClient.snapshot>(),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const snapshot: ConversationSnapshot = {
  conversation: {
    id: 41,
    botId: "bot-1",
    botName: "测试",
    botConfigVersion: "v1",
    agent: {
      model: null,
      thinkingLevel: "medium",
      instructions: "",
      cwd: "",
      extensions: [],
      tools: [],
    },
  },
  goal: { description: "原目标", status: "open", updatedAt: 1, completedAt: null },
  messages: [],
  hasMoreMessages: false,
  activeTasks: [],
  submissions: [],
  configurationErrors: { missingExtensions: [], missingTools: [] },
  apiKeyConfigured: false,
};
const catalog: InitializeResult = {
  bots: [],
  botDefaults: null,
  conversations: [],
  capabilities: { extensions: [], tools: [] },
  configuration: { errors: [], restartRequired: false, ready: true, dataDir: "/test", files: [] },
  apiKeyConfigured: false,
  runtimeVersion: "v24",
};
function setup() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(runnerKeys.catalog, catalog);
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: cache },
      createElement(WorkspaceProvider, null, createElement(WorkspaceUiProvider, null, children)),
    );
  }
  return { cache, Wrapper };
}

it("keeps a newer draft when an earlier submission finishes", async () => {
  const { Wrapper } = setup();
  let finish = (_value: { id: number }) => {};
  vi.mocked(runnerClient.submit).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(runnerClient.snapshot).mockResolvedValue(snapshot);
  const { result } = renderHook(() => useChatActions("bot-1", 41, snapshot), { wrapper: Wrapper });
  act(() => result.current.setInput("第一条"));
  let sending: Promise<boolean> | undefined;
  act(() => {
    sending = result.current.submitMessage();
  });
  act(() => result.current.setInput("继续编辑的新草稿"));
  await act(async () => {
    finish({ id: 1 });
    await sending;
  });
  expect(result.current.input).toBe("继续编辑的新草稿");
  expect(result.current.pendingSubmission).toBeNull();
});

it("preserves a goal draft through polling and resets it when the server goal version changes", () => {
  const { Wrapper } = setup();
  const { result, rerender } = renderHook(({ value }) => useChatActions("bot-1", 41, value), {
    wrapper: Wrapper,
    initialProps: { value: snapshot },
  });
  act(() => result.current.setGoalDraft("未保存的编辑"));
  rerender({
    value: {
      ...snapshot,
      messages: [{ id: 1, role: "assistant", text: "新回复", truncated: false }],
    },
  });
  expect(result.current.goalDraft).toBe("未保存的编辑");
  rerender({
    value: { ...snapshot, goal: { ...snapshot.goal, description: "外部更新", updatedAt: 2 } },
  });
  expect(result.current.goalDraft).toBe("外部更新");
});

it("does not rerender settings for draft edits or snapshot updates", async () => {
  const { cache, Wrapper } = setup();
  vi.mocked(runnerClient.snapshot).mockResolvedValue(snapshot);
  let settingsRenders = 0;
  let chatRenders = 0;
  function Settings() {
    const settings = useRunnerSettings();
    settingsRenders++;
    return createElement("span", null, settings.connection.runtimeVersion);
  }
  function Chat() {
    const value = useConversationSnapshot(41).data;
    const actions = useChatActions("bot-1", 41, value ?? null);
    chatRenders++;
    return createElement(
      "button",
      { onClick: () => actions.setInput("输入变化") },
      actions.input || "编辑草稿",
      value?.messages.length,
    );
  }
  render(createElement(Wrapper, null, createElement(Settings), createElement(Chat)));
  await waitFor(() => expect(cache.getQueryData(runnerKeys.snapshot(41))).toEqual(snapshot));
  const before = settingsRenders;
  const chatBefore = chatRenders;
  fireEvent.click(screen.getByRole("button", { name: /编辑草稿/ }));
  await act(async () => {
    cache.setQueryData(runnerKeys.snapshot(41), {
      ...snapshot,
      messages: [{ id: 1, role: "assistant", text: "回复变化", truncated: false }],
    });
  });
  await waitFor(() => expect(chatRenders).toBeGreaterThan(chatBefore));
  expect(settingsRenders).toBe(before);
});

it("only rerenders UI subscribers whose selected value changes", () => {
  const { Wrapper } = setup();
  let renders = 0;
  function Search() {
    const search = useWorkspaceUi((state) => state.botSearch);
    renders++;
    return createElement("span", null, search);
  }
  function Controls() {
    const toggle = useWorkspaceUi((state) => state.toggleBotList);
    return createElement("button", { onClick: toggle }, "切换侧栏");
  }
  render(createElement(Wrapper, null, createElement(Search), createElement(Controls)));
  const before = renders;
  fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
  expect(renders).toBe(before);
});
