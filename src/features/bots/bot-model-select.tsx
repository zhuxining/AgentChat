import type { ProviderOption } from "@/app/runner-client";

export function BotModelSelect({
  providers,
  provider,
  modelId,
  disabled,
  onChange,
}: {
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
      <select
        aria-label="模型"
        className="bg-background text-foreground h-9 w-full rounded-md border px-2 text-sm"
        value={modelId}
        disabled
      >
        <option value={modelId}>{modelId}</option>
      </select>
    );
  const currentVisible = providers.some(
    (item) => item.name === provider && item.models.includes(modelId),
  );
  return (
    <select
      aria-label="模型"
      className="bg-background text-foreground h-9 w-full rounded-md border px-2 text-sm"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const selected = event.currentTarget.selectedOptions[0];
        if (selected?.dataset.provider && selected.dataset.model)
          onChange(selected.dataset.provider, selected.dataset.model);
      }}
    >
      {!currentVisible && (
        <option value={value}>
          {providers.find((item) => item.name === provider)?.label ?? provider} · {modelId}
          （当前引用）
        </option>
      )}
      {providers.map((item) => (
        <optgroup key={item.name} label={item.label ?? item.name}>
          {item.models.map((model) => (
            <option
              key={model}
              value={JSON.stringify([item.name, model])}
              data-provider={item.name}
              data-model={model}
            >
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
