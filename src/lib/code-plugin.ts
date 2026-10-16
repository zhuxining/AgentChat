import type { CodeHighlighterPlugin } from "streamdown";

import { defaultThemes, loadTokens, supportedLanguages, tokensNow } from "@/lib/highlighter";

// Streamdown's code plugin, backed by the app's own Shiki setup: the JavaScript engine with
// a short language list, instead of the upstream plugin's wasm engine and full catalog.
export const codePlugin: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => supportedLanguages,
  getThemes: () => defaultThemes,
  supportsLanguage: (language) => supportedLanguages.includes(language),
  highlight: ({ code, language }, callback) => {
    const ready = tokensNow(code, language);
    if (ready) {
      return ready;
    }
    void (async () => {
      const tokens = await loadTokens(code, language);
      if (tokens) callback?.(tokens);
    })();
    return null;
  },
};
