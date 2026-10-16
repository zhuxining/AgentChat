import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export function prepareProvider(providedModels?: MutableModels) {
  let providerApiKey = process.env.DEEPSEEK_API_KEY;
  // NodeExecutionEnv gives child tools their configured shell environment; keep secrets out of it.
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const toolEnvironment = { ...process.env };
  const models = providedModels ?? createModels();
  if (!providedModels) {
    const provider = deepseekProvider();
    const apiKeyAuth = provider.auth.apiKey;
    if (!apiKeyAuth) throw new Error("DeepSeek Provider 未配置 API Key 认证接口");
    // pi-ai's bundled DeepSeek catalog currently lists V4 IDs, not the public chat/reasoner API aliases.
    // Register both aliases with conservative limits until they appear in the upstream catalog.
    const reference = provider.getModels()[0];
    if (!reference) throw new Error("DeepSeek Provider 缺少模型定义");
    const aliases = (["deepseek-chat", "deepseek-reasoner"] as const).map((id) => ({
      ...reference,
      id,
      name: id,
      input: ["text"] as ("text" | "image")[],
      reasoning: id === "deepseek-reasoner",
      thinkingLevelMap: undefined,
      contextWindow: 64_000,
      maxTokens: 8_192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }));
    models.setProvider({
      ...provider,
      getModels: () => aliases,
      getAllModels: () => aliases,
      auth: {
        ...provider.auth,
        apiKey: {
          ...apiKeyAuth,
          resolve: async ({ credential, signal }) => {
            signal.throwIfAborted();
            if (credential?.key) {
              return {
                auth: { apiKey: credential.key },
                env: credential.env,
                source: "stored credential",
              };
            }
            return providerApiKey
              ? { auth: { apiKey: providerApiKey }, source: "Runner credential" }
              : undefined;
          },
        },
      },
    });
  }
  return {
    models,
    toolEnvironment,
    isConfigured: () => Boolean(providerApiKey),
    setCredential: (apiKey: unknown) => {
      if (
        apiKey !== null &&
        (typeof apiKey !== "string" || apiKey.trim().length === 0 || apiKey.length > 8_000)
      ) {
        throw new Error("Provider 凭据无效");
      }
      providerApiKey = apiKey === null ? undefined : apiKey;
      return { configured: Boolean(providerApiKey) };
    },
  };
}
