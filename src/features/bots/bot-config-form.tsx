import { useId, useState } from "react";

import type {
  BotDefaults,
  BotDraft,
  ProviderOption,
  RunnerCapabilities,
} from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  const ids = useId();
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
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor={`${ids}-name`}>名称</FieldLabel>
          <Input
            id={`${ids}-name`}
            aria-label="Bot 名称"
            onChange={(event) => updateDraft("name", event.target.value)}
            placeholder="例如：编程助手"
            required
            value={name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-model`}>模型接入与模型</FieldLabel>
          <BotModelSelect
            id={`${ids}-model`}
            providers={providers}
            provider={provider}
            modelId={modelId}
            disabled={busy}
            onChange={(provider, modelId) =>
              setDraft((previous) => ({ ...previous, provider, modelId }))
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-thinking`}>Thinking Level</FieldLabel>
          <NativeSelect
            id={`${ids}-thinking`}
            aria-label="Thinking Level"
            className="w-full"
            onChange={(event) =>
              updateDraft("thinkingLevel", event.target.value as BotDraft["thinkingLevel"])
            }
            value={thinkingLevel}
          >
            {["minimal", "low", "medium", "high", "xhigh"].map((level) => (
              <NativeSelectOption key={level} value={level}>
                {level}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-instructions`}>指令</FieldLabel>
          <Textarea
            id={`${ids}-instructions`}
            aria-label="指令"
            className="min-h-20 resize-y"
            onChange={(event) => updateDraft("instructions", event.target.value)}
            placeholder="可以留空"
            value={instructions}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-cwd`}>默认工作目录</FieldLabel>
          <Input
            id={`${ids}-cwd`}
            aria-label="默认工作目录"
            onChange={(event) => updateDraft("cwd", event.target.value)}
            placeholder="留空时使用 Runner 默认目录"
            value={cwd}
          />
        </Field>
        <CapabilityFields
          capabilities={capabilities}
          extensions={extensions}
          tools={tools}
          onChange={(next) => setDraft((previous) => ({ ...previous, ...next }))}
        />
      </FieldGroup>
      <FieldDescription>
        工作目录只是默认位置，不是文件访问隔离。配置变化只影响新建对话；已有对话需单独应用。
      </FieldDescription>
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
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
