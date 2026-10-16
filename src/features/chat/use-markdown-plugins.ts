import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { useEffect, useState } from "react";
import type { DiagramPlugin, PluginConfig } from "streamdown";

const fencePattern = /^\s*```\s*mermaid\b/m;

const basePlugins: PluginConfig = { code, cjk };

// Mermaid is by far the heaviest plugin, so it is loaded only once a transcript actually
// contains a diagram; every other reply renders without paying for it.
export function useMarkdownPlugins(texts: string[]): PluginConfig {
  const [mermaid, setMermaid] = useState<DiagramPlugin | null>(null);
  const hasDiagram = texts.some((text) => fencePattern.test(text));
  useEffect(() => {
    if (!hasDiagram || mermaid) return;
    let active = true;
    void import("@streamdown/mermaid").then((module) => {
      if (active) setMermaid(module.mermaid);
    });
    return () => {
      active = false;
    };
  }, [hasDiagram, mermaid]);
  return mermaid ? { ...basePlugins, mermaid } : basePlugins;
}
