import { renderMermaidSVG } from "beautiful-mermaid";
import { useMemo } from "react";
import type { CustomRendererProps } from "streamdown";

export function MermaidDiagram({ code }: CustomRendererProps) {
  const result = useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(code, {
          bg: "var(--background)",
          fg: "var(--foreground)",
          accent: "var(--primary)",
          border: "var(--border)",
          transparent: true,
        }),
        error: null,
      };
    } catch (error) {
      return {
        svg: null,
        error: error instanceof Error ? error.message : "无法渲染 Mermaid 图表",
      };
    }
  }, [code]);

  if (result.error) {
    return (
      <pre className="border-destructive/40 bg-muted text-destructive my-4 overflow-x-auto rounded-md border p-3 text-sm">
        Mermaid 渲染失败：{result.error}
      </pre>
    );
  }

  return (
    <div
      aria-label="Mermaid 图表"
      className="my-4 w-full overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg ?? "" }}
      role="img"
    />
  );
}
