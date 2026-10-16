import type { RunnerCapabilities } from "@/app/runner-client";

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
    <div className="space-y-2">
      <fieldset className="space-y-1 rounded-md border p-2">
        <legend className="px-1 text-xs font-medium">Extensions</legend>
        {capabilities.extensions.map((extension) => (
          <label className="flex items-center gap-2 text-xs" key={extension}>
            <input
              checked={selectedExtensions.has(extension)}
              onChange={(event) => toggleExtension(extension, event.target.checked)}
              type="checkbox"
            />
            {extension}
          </label>
        ))}
        {capabilities.extensions.length === 0 && (
          <p className="text-muted-foreground text-xs">Runner 当前没有可用 Extension。</p>
        )}
      </fieldset>
      <fieldset className="space-y-1 rounded-md border p-2">
        <legend className="px-1 text-xs font-medium">Tools</legend>
        {capabilities.tools.map((tool) => (
          <label className="flex items-center gap-2 text-xs" key={`${tool.extension}:${tool.name}`}>
            <input
              checked={selectedTools.has(tool.name)}
              disabled={!selectedExtensions.has(tool.extension)}
              onChange={(event) =>
                onChange({
                  extensions,
                  tools: event.target.checked
                    ? [...new Set([...tools, tool.name])]
                    : tools.filter((item) => item !== tool.name),
                })
              }
              type="checkbox"
            />
            {tool.name} <span className="text-muted-foreground">({tool.extension})</span>
          </label>
        ))}
        {capabilities.tools.length === 0 && (
          <p className="text-muted-foreground text-xs">Runner 当前没有可用 Tool。</p>
        )}
      </fieldset>
    </div>
  );
}
