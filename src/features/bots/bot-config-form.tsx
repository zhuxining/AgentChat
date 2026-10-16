import { useState } from "react";

import type { Bot, BotDefaults, BotDraft, RunnerCapabilities } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { initializeBotDraft } from "@/features/bots/bot-draft";

type Props = {
  bot: Bot | null;
  capabilities: RunnerCapabilities;
  defaults: BotDefaults;
  busy: boolean;
  error: string;
  onSubmit: (draft: BotDraft) => void | Promise<void>;
  onCancel: () => void;
  onArchive?: () => void;
};

// New and edit share field layout, capability gating and validation; their initial values
// and submit semantics stay with the page that owns the flow.
export function BotConfigForm({
  bot,
  capabilities,
  defaults,
  busy,
  error,
  onSubmit,
  onCancel,
  onArchive,
}: Props) {
  const [draft, setDraft] = useState(() => initializeBotDraft(bot, defaults));
  const { name, provider, modelId, thinkingLevel, instructions, cwd, extensions, tools } = draft;
  const selectedExtensions = new Set(extensions);
  const selectedTools = new Set(tools);
  function updateDraft<K extends keyof BotDraft>(field: K, value: BotDraft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }
  function toggleExtension(extensionName: string, checked: boolean) {
    const removedTools = new Set(
      capabilities.tools
        .filter((tool) => tool.extension === extensionName)
        .map((tool) => tool.name),
    );
    setDraft((previous) => ({
      ...previous,
      extensions: checked
        ? [...new Set([...previous.extensions, extensionName])]
        : previous.extensions.filter((item) => item !== extensionName),
      tools: checked ? previous.tools : previous.tools.filter((item) => !removedTools.has(item)),
    }));
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(draft);
      }}
    >
      <label className="block space-y-2 text-sm">
        名称
        <Input
          aria-label="Bot 名称"
          onChange={(event) => updateDraft("name", event.target.value)}
          placeholder="例如：编程助手"
          required
          value={name}
        />
      </label>
      {bot && (
        <p className="text-muted-foreground text-xs break-all">配置版本：{bot.configVersion}</p>
      )}
      <label className="block space-y-2 text-sm">
        Provider 配置名称
        <Input
          aria-label="Provider 配置名称"
          value={provider}
          required
          onChange={(event) => updateDraft("provider", event.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm">
        模型
        <Input
          aria-label="模型 ID"
          value={modelId}
          required
          onChange={(event) => updateDraft("modelId", event.target.value)}
        />
      </label>
      <label className="text-muted-foreground block text-xs">
        Thinking Level
        <select
          aria-label="Thinking Level"
          className="bg-background text-foreground mt-1 h-9 w-full rounded-md border px-2 text-sm"
          onChange={(event) =>
            updateDraft("thinkingLevel", event.target.value as Bot["thinkingLevel"])
          }
          value={thinkingLevel}
        >
          {["minimal", "low", "medium", "high", "xhigh"].map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-2 text-sm">
        指令
        <Textarea
          aria-label="指令"
          className="min-h-20 resize-y"
          onChange={(event) => updateDraft("instructions", event.target.value)}
          placeholder="可以留空"
          value={instructions}
        />
      </label>
      <label className="block space-y-2 text-sm">
        默认工作目录
        <Input
          aria-label="默认工作目录"
          onChange={(event) => updateDraft("cwd", event.target.value)}
          placeholder="留空时使用 Runner 默认目录"
          value={cwd}
        />
      </label>
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
                setDraft((previous) => ({
                  ...previous,
                  tools: event.target.checked
                    ? [...new Set([...previous.tools, tool.name])]
                    : previous.tools.filter((item) => item !== tool.name),
                }))
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
      <p className="text-muted-foreground text-xs leading-5">
        工作目录只是默认位置，不是文件访问隔离。配置变化只影响新建对话；已有对话需单独应用。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !name.trim() || !provider.trim() || !modelId.trim()}
          type="submit"
        >
          {bot ? "保存 Bot" : "创建 Bot"}
        </Button>
        <Button disabled={busy} onClick={() => onCancel()} type="button" variant="outline">
          取消
        </Button>
        {onArchive && (
          <Button disabled={busy} onClick={() => onArchive()} type="button" variant="destructive">
            归档 Bot
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
