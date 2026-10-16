import { cjk } from "@streamdown/cjk";
import { useEffect, useState } from "react";
import type { CustomRenderer, PluginConfig } from "streamdown";

import { codePlugin } from "@/lib/code-plugin";

const fencePattern = /^\s*```\s*mermaid\b/m;

const basePlugins: PluginConfig = { code: codePlugin, cjk };

// beautiful-mermaid and its layout engine are loaded only when the transcript has a diagram.
export function useMarkdownPlugins(texts: string[]): PluginConfig {
  const [renderer, setRenderer] = useState<CustomRenderer | null>(null);
  const hasDiagram = texts.some((text) => fencePattern.test(text));
  useEffect(() => {
    if (!hasDiagram || renderer) return;
    let active = true;
    void import("./mermaid-diagram").then((module) => {
      if (active) setRenderer({ language: "mermaid", component: module.MermaidDiagram });
    });
    return () => {
      active = false;
    };
  }, [hasDiagram, renderer]);
  return renderer ? { ...basePlugins, renderers: [renderer] } : basePlugins;
}
