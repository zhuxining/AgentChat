import { renderMermaidSVG } from "beautiful-mermaid";
import type { DiagramPlugin } from "streamdown";

// Adapt beautiful-mermaid to Streamdown's diagram plugin contract so Streamdown keeps
// ownership of Mermaid fences, the diagram panel, and its built-in controls.
export const beautifulMermaid: DiagramPlugin = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid(_config) {
    return {
      initialize(_config) {},
      async render(_id, source) {
        return {
          svg: renderMermaidSVG(source, {
            bg: "var(--background)",
            fg: "var(--foreground)",
            accent: "var(--primary)",
            border: "var(--border)",
            transparent: true,
          }),
        };
      },
    };
  },
};
