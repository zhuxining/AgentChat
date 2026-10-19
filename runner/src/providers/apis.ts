import type { ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import {
  bedrockConverseStreamApi,
  setBedrockProviderModule,
} from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";

// Both OAuth and Bedrock use explicit public registration for standalone bundles.
setBedrockProviderModule(bedrockProviderModule);
export const chatApis: Record<string, ProviderStreams> = {
  "openai-completions": openAICompletionsApi(),
  "openai-responses": openAIResponsesApi(),
  "azure-openai-responses": azureOpenAIResponsesApi(),
  "openai-codex-responses": openAICodexResponsesApi(),
  "anthropic-messages": anthropicMessagesApi(),
  "bedrock-converse-stream": bedrockConverseStreamApi(),
  "google-generative-ai": googleGenerativeAIApi(),
  "google-vertex": googleVertexApi(),
  "mistral-conversations": mistralConversationsApi(),
  "pi-messages": piMessagesApi(),
};
