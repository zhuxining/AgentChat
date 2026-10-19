import { useState } from "react";

import type {
  BotDefaults,
  BotDraft,
  ProviderOption,
  RunnerCapabilities,
} from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { initializeBotDraft } from "@/features/bots/bot-draft";
import { BotModelSelect } from "@/features/bots/bot-model-select";
import { CapabilityFields } from "@/features/bots/capability-fields";

type Props = {
  providers: ProviderOption[];
  capabilities: RunnerCapabilities;
  defaults: BotDefaults;
  busy: boolean;
  error: string;
  onSubmit: (draft: BotDraft) => void | Promise<void>;
  onCancel: () => void;
};

// Creation still needs the full field set at once; later changes happen inline on the
// Bot detail view instead of reopening a form.
export function BotConfigForm({
  providers,
  capabilities,
  defaults,
  busy,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState(() => initializeBotDraft(null, defaults));
  const { name, provider, modelId, thinkingLevel, instructions, cwd, extensions, tools } = draft;
  function updateDraft<K extends keyof BotDraft>(field: K, value: BotDraft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
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
      <label className="block space-y-2 text-sm">
        模型接入与模型
        <BotModelSelect
          providers={providers}
          provider={provider}
          modelId={modelId}
          disabled={busy}
          onChange={(provider, modelId) =>
            setDraft((previous) => ({ ...previous, provider, modelId }))
          }
        />
      </label>
      <label className="text-muted-foreground block text-xs">
        Thinking Level
        <select
          aria-label="Thinking Level"
          className="bg-background text-foreground mt-1 h-9 w-full rounded-md border px-2 text-sm"
          onChange={(event) =>
            updateDraft("thinkingLevel", event.target.value as BotDraft["thinkingLevel"])
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
      <CapabilityFields
        capabilities={capabilities}
        extensions={extensions}
        tools={tools}
        onChange={(next) => setDraft((previous) => ({ ...previous, ...next }))}
      />
      <p className="text-muted-foreground text-xs leading-5">
        工作目录只是默认位置，不是文件访问隔离。配置变化只影响新建对话；已有对话需单独应用。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !name.trim() || !provider.trim() || !modelId.trim()}
          type="submit"
        >
          创建 Bot
        </Button>
        <Button disabled={busy} onClick={() => onCancel()} type="button" variant="outline">
          取消
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
