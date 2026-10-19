import type { MutableModels } from "@earendil-works/pi-ai/models";

/** Provider secrets stay available to adapters, but never enter a tool's shell environment. */
export function toolEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !/API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|AUTH_TOKEN|^AWS_|^GOOGLE_APPLICATION_CREDENTIALS$|^COPILOT_GITHUB_TOKEN$|^HF_TOKEN$/i.test(
          name,
        ),
    ),
  );
}
/** Legacy IPC compatibility, scoped solely to the migrated DeepSeek keyring reference. */
export function prepareProvider(providedModels?: MutableModels) {
  let apiKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  return {
    providedModels,
    toolEnvironment: toolEnvironment(),
    isConfigured: () => Boolean(apiKey),
    legacyCredential: () => apiKey,
    setCredential(value: unknown) {
      if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 8000))
        throw new Error("Provider 凭据无效");
      apiKey = value === null ? undefined : (value as string);
      return { configured: Boolean(apiKey) };
    },
  };
}
