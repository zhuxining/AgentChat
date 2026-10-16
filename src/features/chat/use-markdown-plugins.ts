import { cjk } from "@streamdown/cjk";
import { useEffect, useState } from "react";
import type { DiagramPlugin, PluginConfig } from "streamdown";

import { codePlugin } from "@/lib/code-plugin";

const fencePattern = /^\s*```\s*mermaid\b/m;

const basePlugins: PluginConfig = { code: codePlugin, cjk };

// Load the diagram adapter and beautiful-mermaid only when a transcript contains a diagram.
export function useMarkdownPlugins(texts: string[]): PluginConfig {
  const [mermaid, setMermaid] = useState<DiagramPlugin | null>(null);
  const hasDiagram = texts.some((text) => fencePattern.test(text));
  useEffect(() => {
    if (!hasDiagram || mermaid) return;
    let active = true;
    void import("./beautiful-mermaid-plugin").then((module) => {
      if (active) setMermaid(module.beautifulMermaid);
    });
    return () => {
      active = false;
    };
  }, [hasDiagram, mermaid]);
  return mermaid ? { ...basePlugins, mermaid } : basePlugins;
}
