import * as React from "react";
import {
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
  type TokensResult,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { BundledLanguage, BundledTheme } from "streamdown";

// Add the languages you need. Each one loads the first time it is used.
const languages = {
  bash: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

const aliases: Record<string, keyof typeof languages> = {
  js: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

let highlighter: Promise<HighlighterCore> | undefined;
let resolved: HighlighterCore | null = null;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    // The JavaScript engine avoids shipping the WASM payload with the desktop bundle.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }).then((core) => {
    resolved = core;
    return core;
  });

  return highlighter;
}

/** Languages this app can highlight, including aliases. */
export const supportedLanguages = [
  ...Object.keys(languages),
  ...Object.keys(aliases),
] as BundledLanguage[];

export const defaultThemes = ["github-light", "github-dark"] as [BundledTheme, BundledTheme];

function toTokens(core: HighlighterCore, code: string, lang: string): TokensResult {
  return core.codeToTokens(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

/**
 * Tokens for already-loaded grammars, or null while the grammar still loads. Used by
 * Streamdown's code plugin, which asks synchronously before falling back to a callback.
 */
export function tokensNow(code: string, language: string): TokensResult | null {
  const core = resolved;
  const lang = getLanguage(language);

  if (!core || !lang) {
    return null;
  }

  if (lang !== "ansi" && !core.getLoadedLanguages().includes(lang)) {
    return null;
  }

  return toTokens(core, code, lang);
}

/** Tokens once the grammar is ready, or null for a language that is not listed. */
export async function loadTokens(code: string, language: string): Promise<TokensResult | null> {
  const lang = getLanguage(language);

  if (!lang) {
    return null;
  }

  const core = await getHighlighter();

  if (lang !== "ansi" && !core.getLoadedLanguages().includes(lang)) {
    await core.loadLanguage(languages[lang]);
  }

  return toTokens(core, code, lang);
}

function getLanguage(language: string) {
  const name = language.toLowerCase();

  if (name === "ansi") {
    return name;
  }

  if (name in languages) {
    return name as keyof typeof languages;
  }

  return aliases[name] ?? null;
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string) {
  const lang = getLanguage(language);

  if (!lang) {
    return null;
  }

  const shiki = await getHighlighter();

  if (lang !== "ansi" && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(languages[lang]);
  }

  return {
    // Returns one React node per line, and the grammar state after the last
    // line. Pass that state back to continue where the code left off.
    highlight(code: string, state?: GrammarState) {
      const tokenize = (text: string) =>
        shiki.codeToTokens(text, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          grammarState: state,
        }).tokens;

      // ANSI has no grammar state, so each line is tokenized on its own and
      // gets the same colors whether it arrives in one piece or streams.
      const tokens =
        lang === "ansi" ? code.split("\n").flatMap((line) => tokenize(line)) : tokenize(code);

      return {
        lines: tokens.map((line) =>
          line.map((token, index) => (
            <span
              key={index}
              style={token.htmlStyle as React.CSSProperties}
              className="text-(--shiki-light) dark:text-(--shiki-dark)"
            >
              {token.content}
            </span>
          )),
        ),
        state: shiki.getLastGrammarState(tokens),
      };
    },
  };
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
  const highlighter = await loadHighlighter(language);

  return highlighter ? highlighter.highlight(code).lines : null;
}
