import { useState } from "react";

import type { Bot, BotDraft, RunnerCapabilities } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { initializeBotDraft } from "@/features/chat/bot-draft";

type Props = {
  open: boolean;
  bot: Bot | null;
  capabilities: RunnerCapabilities;
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: BotDraft) => Promise<boolean>;
  onArchive: (bot: Bot) => Promise<boolean>;
};

export function BotEditorDialog({
  open,
  bot,
  capabilities,
  busy,
  error,
  onOpenChange,
  onSave,
  onArchive,
}: Props) {
  async function save(draft: BotDraft) {
    if (await onSave(draft)) onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bot ? "编辑智能体" : "新建智能体"}</DialogTitle>
          <DialogDescription>设置名称、描述、模型和可用工具。</DialogDescription>
        </DialogHeader>
        <BotEditorForm
          key={bot?.id ?? "new"}
          bot={bot}
          capabilities={capabilities}
          busy={busy}
          error={error}
          onSave={save}
          onCancel={() => onOpenChange(false)}
        />
        {bot && (
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void onArchive(bot).then((saved) => {
                if (saved) onOpenChange(false);
              });
            }}
          >
            归档智能体
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BotEditorForm({
  bot,
  capabilities,
  busy,
  error,
  onSave,
  onCancel,
}: Pick<Props, "bot" | "capabilities" | "busy" | "error"> & {
  onSave: (draft: BotDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => initializeBotDraft(bot, capabilities));
  const { name, modelId, thinkingLevel, instructions, cwd, extensions, tools } = draft;
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
        void onSave(draft);
      }}
    >
      <Input
        aria-label="Bot 名称"
        onChange={(event) => updateDraft("name", event.target.value)}
        placeholder="名称"
        required
        value={name}
      />
      <label className="block space-y-2 text-sm">
        模型
        <select
          aria-label="模型 ID"
          className="bg-background h-9 w-full rounded-md border px-2"
          value={modelId}
          onChange={(event) => updateDraft("modelId", event.target.value)}
        >
          <option value="deepseek-chat">DeepSeek Chat</option>
          <option value="deepseek-reasoner">DeepSeek Reasoner · 深度思考</option>
        </select>
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
      <Textarea
        aria-label="指令"
        className="min-h-20 resize-y"
        onChange={(event) => updateDraft("instructions", event.target.value)}
        value={instructions}
      />
      <Input
        aria-label="默认工作目录"
        onChange={(event) => updateDraft("cwd", event.target.value)}
        placeholder="默认工作目录（可留空）"
        value={cwd}
      />
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
        工作目录只是默认位置，不是文件访问隔离。配置变化只影响新建
        Conversation；已有对话需单独应用。
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || !name.trim() || !modelId.trim()} type="submit">
          {bot?.id ? "保存智能体" : "创建智能体"}
        </Button>
        {bot?.id && (
          <Button disabled={busy} onClick={() => onCancel()} type="button" variant="outline">
            取消
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
