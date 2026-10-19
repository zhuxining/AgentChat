import type { ProviderOption } from "@/app/runner-client";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";

// Provider + model is one reference, so it stays a single control. The composite option
// value keeps both halves in one string; the provider travels on data attributes because
// native optgroup/option elements cannot carry structured values.
export function BotModelSelect({
  id,
  providers,
  provider,
  modelId,
  disabled,
  onChange,
}: {
  id?: string;
  providers: ProviderOption[];
  provider: string;
  modelId: string;
  disabled?: boolean;
  onChange: (provider: string, modelId: string) => void;
}) {
  const value = JSON.stringify([provider, modelId]);
  // Older backgrounds do not report a provider catalog; keep their single current
  // reference readable instead of exposing the composite option encoding.
  if (providers.length === 0)
    return (
      <NativeSelect id={id} aria-label="模型" className="w-full" size="sm" disabled>
        <NativeSelectOption value={modelId}>{modelId}</NativeSelectOption>
      </NativeSelect>
    );
  const currentVisible = providers.some(
    (item) => item.name === provider && item.models.includes(modelId),
  );
  return (
    <NativeSelect
      id={id}
      aria-label="模型"
      className="w-full"
      size="sm"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const selected = event.currentTarget.selectedOptions[0];
        if (selected?.dataset.provider && selected.dataset.model)
          onChange(selected.dataset.provider, selected.dataset.model);
      }}
    >
      {!currentVisible && (
        <NativeSelectOption value={value}>
          {providers.find((item) => item.name === provider)?.label ?? provider} · {modelId}
          （当前引用）
        </NativeSelectOption>
      )}
      {providers.map((item) => (
        <NativeSelectOptGroup key={item.name} label={item.label ?? item.name}>
          {item.models.map((model) => (
            <NativeSelectOption
              key={model}
              value={JSON.stringify([item.name, model])}
              data-provider={item.name}
              data-model={model}
            >
              {model}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
}
