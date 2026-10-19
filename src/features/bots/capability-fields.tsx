import { useId } from "react";

import type { RunnerCapabilities } from "@/app/runner-client";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

// Extension/工具选择在新建表单与详情弹窗里共用；两者的保存时机由调用方决定。
export function CapabilityFields({
  capabilities,
  extensions,
  tools,
  onChange,
}: {
  capabilities: RunnerCapabilities;
  extensions: string[];
  tools: string[];
  onChange: (next: { extensions: string[]; tools: string[] }) => void;
}) {
  const selectedExtensions = new Set(extensions);
  const selectedTools = new Set(tools);
  // Base UI 的 Checkbox 渲染的是 span + 隐藏 input，可见控件需要显式 id 才能与标签关联。
  const ids = useId();
  function toggleExtension(name: string, checked: boolean) {
    const removedTools = new Set(
      capabilities.tools.filter((tool) => tool.extension === name).map((tool) => tool.name),
    );
    onChange({
      extensions: checked
        ? [...new Set([...extensions, name])]
        : extensions.filter((item) => item !== name),
      tools: checked ? tools : tools.filter((item) => !removedTools.has(item)),
    });
  }
  return (
    <div className="space-y-3">
      <FieldSet className="block space-y-1.5 rounded-lg border p-3">
        <FieldLegend variant="label" className="mb-1">
          Extensions
        </FieldLegend>
        {capabilities.extensions.map((extension) => (
          <Field key={extension} orientation="horizontal" className="gap-2">
            <Checkbox
              id={`${ids}-extension-${extension}`}
              checked={selectedExtensions.has(extension)}
              onCheckedChange={(checked) => toggleExtension(extension, checked)}
            />
            <FieldLabel htmlFor={`${ids}-extension-${extension}`} className="text-xs font-normal">
              {extension}
            </FieldLabel>
          </Field>
        ))}
        {capabilities.extensions.length === 0 && (
          <p className="text-muted-foreground text-xs">Runner 当前没有可用 Extension。</p>
        )}
      </FieldSet>
      <FieldSet className="block space-y-1.5 rounded-lg border p-3">
        <FieldLegend variant="label" className="mb-1">
          Tools
        </FieldLegend>
        {capabilities.tools.map((tool) => {
          const id = `${ids}-tool-${tool.extension}-${tool.name}`;
          return (
            <Field
              key={`${tool.extension}:${tool.name}`}
              orientation="horizontal"
              className="gap-2"
            >
              <Checkbox
                id={id}
                checked={selectedTools.has(tool.name)}
                disabled={!selectedExtensions.has(tool.extension)}
                onCheckedChange={(checked) =>
                  onChange({
                    extensions,
                    tools: checked
                      ? [...new Set([...tools, tool.name])]
                      : tools.filter((item) => item !== tool.name),
                  })
                }
              />
              <FieldLabel htmlFor={id} className="text-xs font-normal">
                {tool.name} <span className="text-muted-foreground">({tool.extension})</span>
              </FieldLabel>
            </Field>
          );
        })}
        {capabilities.tools.length === 0 && (
          <p className="text-muted-foreground text-xs">Runner 当前没有可用 Tool。</p>
        )}
      </FieldSet>
    </div>
  );
}
