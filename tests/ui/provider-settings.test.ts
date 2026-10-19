import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type {
  ProviderInstance,
  ProviderModel,
  ProviderRequest,
  ProviderResponse,
} from "../../contracts/providers";
import { runnerClient } from "../../src/app/runner-client";
import { BotModelSelect } from "../../src/features/bots/bot-model-select";
import { OAuthSettings } from "../../src/features/settings/provider-oauth";
import { addressSummary, ProviderSettings } from "../../src/features/settings/provider-settings";

const restartRunner = vi.hoisted(() => vi.fn<() => Promise<boolean>>(async () => true));
vi.mock("../../src/app/runner-client", () => ({
  runnerClient: { providerRequest: vi.fn<typeof runnerClient.providerRequest>() },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn<typeof openUrl>(async () => undefined),
}));
vi.mock("../../src/features/settings/use-runner-actions", () => ({
  useRunnerSettings: () => ({
    connection: { busy: false },
    actions: { restartRunner },
    feedback: { error: "" },
  }),
}));

const initial: ProviderInstance = {
  id: "company",
  name: "公司网关",
  type: "openai",
  enabled: true,
  auth: { type: "apiKey", source: { type: "keyring", entry: "company" } },
  visibleModels: ["model-a"],
  modelOverrides: {},
  customModels: [],
};
const model: ProviderModel = {
  id: "model-a",
  name: "模型 A",
  custom: false,
  overridden: false,
  visible: true,
  definition: {
    id: "model-a",
    name: "模型 A",
    api: "openai-completions",
    baseUrl: "https://api.example.test",
    input: ["text"],
    reasoning: false,
    contextWindow: 64000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};
let instance: ProviderInstance;
let version: string;
let configured: boolean;
let configuredInstances: ProviderInstance[];
const catalog = [
  {
    type: "openai",
    name: "OpenAI",
    authentication: ["apiKey", "oauth", "ambient"] as const,
    modelCount: 1,
    apis: ["openai-completions"],
  },
  {
    type: "deepseek",
    name: "DeepSeek",
    authentication: ["apiKey"] as const,
    modelCount: 1,
    apis: ["openai-completions"],
  },
];

function reply(): ProviderResponse {
  return {
    version,
    restartRequired: version !== "v1",
    catalog: catalog.map((entry) => ({ ...entry, authentication: [...entry.authentication] })),
    instances: configuredInstances.map((item) => ({
      instance: item,
      configured,
      status: configured ? "configured" : "missing",
    })),
    models: [
      { ...model, definition: { ...model.definition, ...instance.modelOverrides[model.id] } },
    ],
    references: [{ kind: "bot", id: "bot-1", modelId: "model-a" }],
  };
}
async function handle(request: ProviderRequest): Promise<ProviderResponse> {
  if (request.action === "save") {
    instance = request.instance;
    configuredInstances = [instance];
    version = version === "v1" ? "v2" : "v3";
    return { ...reply(), saved: true };
  }
  if (request.action === "writeCredential") {
    configured = true;
    return reply();
  }
  if (request.action === "remove") throw new Error("仍被 Bot bot-1 和会话 41 引用");
  if (request.action === "test")
    return {
      ...reply(),
      test: {
        instanceId: request.instanceId,
        modelId: request.modelId,
        version,
        testedAt: "2026-10-19T12:00:00Z",
        success: true,
        message: "请求成功",
      },
    };
  return reply();
}
beforeEach(() => {
  instance = structuredClone(initial);
  version = "v1";
  configured = true;
  configuredInstances = [instance];
  vi.mocked(runnerClient.providerRequest).mockImplementation(handle);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount(element: ReactNode = createElement(ProviderSettings)) {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      element,
    ),
  );
}
async function openInstance() {
  fireEvent.click(await screen.findByRole("button", { name: /公司网关/ }));
  return screen.findByLabelText("接入名称");
}

it("searches built-in suppliers and saves a new stable instance without sending a model request", async () => {
  configuredInstances = [];
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加接入" }));
  fireEvent.change(screen.getByLabelText("搜索内置供应商"), { target: { value: "deepseek" } });
  expect(screen.queryByRole("button", { name: /OpenAI ·/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /DeepSeek ·/ }));
  fireEvent.change(await screen.findByLabelText("接入名称"), {
    target: { value: "我的 DeepSeek" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  await waitFor(() =>
    expect(runnerClient.providerRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "save",
        expectedVersion: "v1",
        instance: expect.objectContaining({ name: "我的 DeepSeek", type: "deepseek" }),
      }),
    ),
  );
  expect(
    vi
      .mocked(runnerClient.providerRequest)
      .mock.calls.some(([request]) => request.action === "test"),
  ).toBe(false);
});

it("clears saved secrets, keeps errors visible, and protects referenced instances from deletion", async () => {
  mount();
  await openInstance();
  const input = screen.getByLabelText("新的 API Key") as HTMLInputElement;
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: "test-secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "安全保存凭据" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(runnerClient.providerRequest).toHaveBeenCalledWith({
    action: "writeCredential",
    instanceId: "company",
    value: "test-secret-value",
  });
  expect(screen.queryByText("test-secret-value")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除接入…" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除接入" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "仍被 Bot bot-1 和会话 41 引用",
  );
  expect(screen.getByLabelText("接入名称")).toBeTruthy();
});

it("saves only the chosen environment source and makes file references explicit", async () => {
  mount();
  await openInstance();
  fireEvent.change(screen.getByLabelText("凭据来源"), { target: { value: "env" } });
  expect(screen.queryByLabelText("新的 API Key")).toBeNull();
  fireEvent.change(screen.getByLabelText("环境变量名"), { target: { value: "COMPANY_TOKEN" } });
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  await waitFor(() =>
    expect(instance.auth).toEqual({
      type: "apiKey",
      source: { type: "env", variable: "COMPANY_TOKEN" },
    }),
  );
  fireEvent.change(await screen.findByLabelText("凭据来源"), { target: { value: "file" } });
  expect((screen.getByLabelText("凭据文件路径") as HTMLInputElement).value).toBe(
    "credentials/providers.json",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  await waitFor(() =>
    expect(instance.auth.type === "apiKey" && instance.auth.source.type).toBe("file"),
  );
  fireEvent.change(screen.getByLabelText("文件值格式"), { target: { value: "env" } });
  fireEvent.change(screen.getByLabelText("新的 API Key"), { target: { value: "COMPANY_TOKEN" } });
  fireEvent.click(screen.getByRole("button", { name: "安全保存凭据" }));
  await waitFor(() =>
    expect(runnerClient.providerRequest).toHaveBeenCalledWith({
      action: "writeCredential",
      instanceId: "company",
      value: "${COMPANY_TOKEN}",
    }),
  );
});

it("shares form and JSON model edits, preserves inheritance, and restores built-in defaults", async () => {
  mount();
  await openInstance();
  fireEvent.click(screen.getByRole("button", { name: "模型" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑模型 model-a" }));
  expect((screen.getByLabelText("模型高级 JSON") as HTMLTextAreaElement).value).toBe("{}");
  fireEvent.change(screen.getByLabelText("上下文上限"), { target: { value: "32000" } });
  expect(JSON.parse((screen.getByLabelText("模型高级 JSON") as HTMLTextAreaElement).value)).toEqual(
    { contextWindow: 32000 },
  );
  fireEvent.change(screen.getByLabelText("模型高级 JSON"), {
    target: { value: '{"contextWindow":16000,"compat":{"supportsStore":false}}' },
  });
  expect((screen.getByLabelText("上下文上限") as HTMLInputElement).value).toBe("16000");
  fireEvent.click(screen.getByRole("button", { name: "应用模型草稿" }));
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  await waitFor(() =>
    expect(instance.modelOverrides).toEqual({
      "model-a": { contextWindow: 16000, compat: { supportsStore: false } },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "模型" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复 model-a 内置默认值" }));
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  await waitFor(() => expect(instance.modelOverrides).toEqual({}));
});

it("marks tests stale when editing and requires confirmation before restarting a busy backend", async () => {
  mount();
  await openInstance();
  fireEvent.click(screen.getByRole("button", { name: "测试已保存配置" }));
  expect(await screen.findByText("连接测试成功")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("接入名称"), { target: { value: "网关新名称" } });
  expect(screen.getByText(/结果已过期/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  fireEvent.click(await screen.findByRole("button", { name: "重启后台并应用" }));
  const dialog = within(await screen.findByRole("dialog", { name: "重新启动后台" }));
  expect(dialog.getByText(/重启可能中断正在执行的工作/)).toBeTruthy();
  expect(restartRunner).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "确认重新启动" }));
  await waitFor(() => expect(restartRunner).toHaveBeenCalledTimes(1));
});

it("handles OAuth selection prompts, opens only validated system-browser links, and cancels on leaving", async () => {
  const login = {
    id: "login-1",
    instanceId: "company",
    status: "pending" as const,
    url: "https://auth.example.test/authorize",
    prompt: {
      type: "select" as const,
      message: "选择区域",
      options: [
        { id: "us", label: "美国" },
        { id: "eu", label: "欧洲" },
      ],
    },
  };
  vi.mocked(runnerClient.providerRequest).mockImplementation(async (request) =>
    request.action.startsWith("login") ? { ...reply(), login } : reply(),
  );
  const view = mount(createElement(OAuthSettings, { instanceId: "company", configured: false }));
  fireEvent.click(screen.getByRole("button", { name: "登录授权" }));
  fireEvent.click(await screen.findByRole("button", { name: "在系统浏览器打开授权页面" }));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://auth.example.test/authorize"));
  fireEvent.change(screen.getByLabelText("OAuth 授权响应"), { target: { value: "eu" } });
  fireEvent.click(screen.getByRole("button", { name: "提交授权响应" }));
  await waitFor(() =>
    expect(runnerClient.providerRequest).toHaveBeenCalledWith({
      action: "loginRespond",
      loginId: "login-1",
      value: "eu",
    }),
  );
  view.unmount();
  expect(runnerClient.providerRequest).toHaveBeenCalledWith({
    action: "cancelLogin",
    loginId: "login-1",
  });
});

it("groups Bot model options by display name while persisting stable IDs", () => {
  const onChange = vi.fn<(provider: string, modelId: string) => void>();
  render(
    createElement(BotModelSelect, {
      providers: [{ name: "instance-123", label: "公司 OpenAI", models: ["model-a"] }],
      provider: "instance-123",
      modelId: "model-a",
      onChange,
    }),
  );
  const select = screen.getByLabelText("模型") as HTMLSelectElement;
  expect(select.querySelector("optgroup")?.label).toBe("公司 OpenAI");
  fireEvent.change(select, { target: { value: JSON.stringify(["instance-123", "model-a"]) } });
  expect(onChange).toHaveBeenCalledWith("instance-123", "model-a");
});

it("redacts URL credentials and query values from address summaries", () => {
  expect(addressSummary("https://user:secret@example.test/v1?api_key=secret#secret")).toBe(
    "https://example.test/v1",
  );
  expect(addressSummary("invalid-secret-value")).toBe("地址无效");
});

it("creates custom models with the instance identity and supplier API protocol", async () => {
  mount();
  await openInstance();
  fireEvent.click(screen.getByRole("button", { name: "模型" }));
  fireEvent.click(screen.getByRole("button", { name: "添加自定义模型" }));
  fireEvent.change(screen.getByLabelText("自定义模型 ID"), { target: { value: "custom-a" } });
  fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "定制模型" } });
  expect((screen.getByLabelText("模型 API 协议") as HTMLSelectElement).value).toBe(
    "openai-completions",
  );
  const json = JSON.parse((screen.getByLabelText("模型高级 JSON") as HTMLTextAreaElement).value);
  expect(json).toMatchObject({
    provider: "company",
    api: "openai-completions",
    baseUrl: "https://api.example.test",
  });
  fireEvent.click(screen.getByRole("button", { name: "应用模型草稿" }));
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  await waitFor(() =>
    expect(instance.customModels[0]).toMatchObject({
      id: "custom-a",
      provider: "company",
      name: "定制模型",
    }),
  );
});

it("restores an inherited field and deeply merges the original catalog defaults", async () => {
  instance.modelOverrides = { "model-a": { contextWindow: 32000, cost: { input: 7 } } };
  vi.mocked(runnerClient.providerRequest).mockImplementation(async (request) => {
    const response = await handle(request);
    return {
      ...response,
      models: [
        {
          ...model,
          defaults: model.definition,
          definition: {
            ...model.definition,
            contextWindow: 32000,
            cost: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        },
      ],
    };
  });
  mount();
  await openInstance();
  fireEvent.click(screen.getByRole("button", { name: "模型" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑模型 model-a" }));
  expect((screen.getByLabelText("上下文上限") as HTMLInputElement).value).toBe("32000");
  fireEvent.click(screen.getByRole("button", { name: "恢复上下文上限默认值" }));
  expect((screen.getByLabelText("上下文上限") as HTMLInputElement).value).toBe("64000");
  fireEvent.change(screen.getByLabelText("模型高级 JSON"), {
    target: { value: '{"cost":{"input":2}}' },
  });
  const preview = screen.getByText(/"cacheRead": 0/, { selector: "pre" });
  expect(preview.textContent).toContain('"input": 2');
  expect(preview.textContent).toContain('"output": 0');
});

it("preserves a connection draft on conflict without leaking credential material", async () => {
  vi.mocked(runnerClient.providerRequest).mockImplementation(async (request) => {
    if (request.action === "save") throw new Error("配置已被修改，请刷新后重试");
    return handle(request);
  });
  mount();
  await openInstance();
  fireEvent.change(screen.getByLabelText("接入名称"), { target: { value: "保留的名称草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "保存接入" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "配置已被修改，请刷新后重试",
  );
  expect((screen.getByLabelText("接入名称") as HTMLInputElement).value).toBe("保留的名称草稿");
});

it("rejects non-web OAuth links and masks secret prompts", async () => {
  const login = {
    id: "login-secret",
    instanceId: "company",
    status: "pending" as const,
    url: "javascript:alert('bad')",
    prompt: { type: "secret" as const, message: "粘贴授权码" },
  };
  vi.mocked(runnerClient.providerRequest).mockImplementation(async (request) =>
    request.action.startsWith("login") ? { ...reply(), login } : reply(),
  );
  mount(createElement(OAuthSettings, { instanceId: "company", configured: false }));
  fireEvent.click(screen.getByRole("button", { name: "登录授权" }));
  fireEvent.click(await screen.findByRole("button", { name: "在系统浏览器打开授权页面" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "授权地址无效。");
  expect(openUrl).not.toHaveBeenCalled();
  expect((screen.getByLabelText("OAuth 授权响应") as HTMLInputElement).type).toBe("password");
});
