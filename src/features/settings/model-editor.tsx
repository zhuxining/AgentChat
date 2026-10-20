import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";

import type { Json, ProviderInstance, ProviderModel } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

function scalar(value: Json | undefined) {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

type ObjectValue = { [key: string]: Json };

function isObject(value: Json | undefined): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function mergeModelDefaults(defaults: ObjectValue, override: ObjectValue): ObjectValue {
  return Object.fromEntries(
    [...new Set([...Object.keys(defaults), ...Object.keys(override)])].map((key) => {
      const base = defaults[key];
      const value = override[key];
      return [
        key,
        value === undefined
          ? (base ?? null)
          : isObject(base) && isObject(value)
            ? mergeModelDefaults(base, value)
            : value,
      ];
    }),
  );
}

export function parseObject(text: string): ObjectValue {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("JSON 必须是对象。");
  return parsed as ObjectValue;
}

export function ModelEditor({
  instance,
  model,
  template,
  apiOptions,
  onChange,
  onClose,
}: {
  instance: ProviderInstance;
  model: ProviderModel | null;
  template?: ObjectValue;
  apiOptions: string[];
  onChange: (instance: ProviderInstance) => void;
  onClose: () => void;
}) {
  const custom = !model || model.custom;
  const initial = model
    ? custom
      ? model.definition
      : (instance.modelOverrides[model.id] ?? {})
    : {
        id: "",
        name: "",
        provider: instance.id,
        api: typeof template?.api === "string" ? template.api : (apiOptions[0] ?? ""),
        baseUrl: instance.baseUrl ?? template?.baseUrl ?? "",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
  // JSON text is the sole draft. Form controls read and update the same document.
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = useState("");
  const ids = useId();
  let draft: ObjectValue | null = null;
  try {
    draft = parseObject(text);
  } catch {
    /* An incomplete JSON draft remains editable. */
  }
  const effective = custom
    ? (draft ?? {})
    : mergeModelDefaults(model?.defaults ?? model?.definition ?? {}, draft ?? {});

  function reset(field: string) {
    if (!draft) return;
    const value = { ...draft };
    delete value[field];
    setText(JSON.stringify(value, null, 2));
  }

  function update(field: string, value: Json) {
    if (!draft) return;
    setText(JSON.stringify({ ...draft, [field]: value }, null, 2));
    setError("");
  }
  function apply() {
    try {
      const value = parseObject(text);
      if (custom) {
        if (typeof value.id !== "string" || !value.id.trim())
          throw new Error("自定义模型必须填写模型 ID。");
        if (value.provider !== instance.id)
          throw new Error("自定义模型 provider 必须与接入稳定 ID 一致。");
        if (typeof value.api !== "string" || !value.api) throw new Error("请选择模型 API 协议。");
        if (typeof value.name !== "string" || !value.name) throw new Error("请填写模型名称。");
        if (model && value.id !== model.id) throw new Error("模型 ID 不可更改，请新建自定义模型。");
        if (instance.customModels.some((item) => item.id === value.id && item.id !== model?.id))
          throw new Error("模型 ID 已存在。");
        onChange({
          ...instance,
          customModels: [...instance.customModels.filter((item) => item.id !== model?.id), value],
        });
      } else if (model) {
        if ((value.id !== undefined && value.id !== model.id) || value.provider !== undefined)
          throw new Error("内置模型的 ID 与接入身份不可覆盖。");
        onChange({
          ...instance,
          modelOverrides: { ...instance.modelOverrides, [model.id]: value },
        });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型配置无效");
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model ? `编辑 ${model.name}` : "添加自定义模型"}</DialogTitle>
        <DialogDescription>
          {custom
            ? "填写模型 ID 和名称后，可在模型选项中补充能力参数。"
            : "仅保存相对内置目录的修改。"}
        </DialogDescription>
      </DialogHeader>
      <div aria-label="模型编辑" className="space-y-3">
        {custom && (
          <Field>
            <FieldLabel htmlFor={`${ids}-id`}>模型 ID</FieldLabel>
            <Input
              id={`${ids}-id`}
              aria-label="自定义模型 ID"
              value={scalar(effective.id)}
              disabled={!!model || !draft}
              onChange={(event) => update("id", event.target.value)}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${ids}-name`}>模型名称</FieldLabel>
          <Input
            id={`${ids}-name`}
            aria-label="模型名称"
            disabled={!draft}
            value={scalar(effective.name)}
            onChange={(event) => update("name", event.target.value)}
          />
        </Field>
        {custom && (
          <Field>
            <FieldLabel htmlFor={`${ids}-api`}>API 协议</FieldLabel>
            <NativeSelect
              id={`${ids}-api`}
              aria-label="模型 API 协议"
              className="w-full"
              disabled={!draft}
              value={typeof effective.api === "string" ? effective.api : ""}
              onChange={(event) => update("api", event.target.value)}
            >
              <NativeSelectOption value="">选择协议</NativeSelectOption>
              {[
                ...new Set([
                  ...apiOptions,
                  ...(typeof effective.api === "string" && effective.api ? [effective.api] : []),
                ]),
              ].map((api) => (
                <NativeSelectOption key={api} value={api}>
                  {api}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Collapsible className="rounded-md border px-3">
          <CollapsibleTrigger className="group/collapsible-trigger focus-visible:ring-ring flex w-full items-center gap-2 py-3 text-left text-sm font-medium outline-none focus-visible:ring-2">
            <ChevronRight
              className="size-4 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
              aria-hidden="true"
            />
            模型选项
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pb-3">
            {!custom && (
              <Field>
                <FieldLabel htmlFor={`${ids}-api`}>API 协议</FieldLabel>
                <NativeSelect
                  id={`${ids}-api`}
                  aria-label="模型 API 协议"
                  className="w-full"
                  disabled={!draft}
                  value={typeof effective.api === "string" ? effective.api : ""}
                  onChange={(event) => update("api", event.target.value)}
                >
                  <NativeSelectOption value="">选择协议</NativeSelectOption>
                  {[
                    ...new Set([
                      ...apiOptions,
                      ...(typeof effective.api === "string" && effective.api
                        ? [effective.api]
                        : []),
                    ]),
                  ].map((api) => (
                    <NativeSelectOption key={api} value={api}>
                      {api}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {(
              [
                ["baseUrl", "模型端点"],
                ["contextWindow", "上下文上限"],
                ["maxTokens", "输出上限"],
              ] as const
            ).map(([field, label]) => (
              <Field key={field}>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor={`${ids}-${field}`}>{label}</FieldLabel>
                  <span className="text-muted-foreground text-xs">
                    {draft && field in draft ? "已覆盖" : "继承默认值"}
                  </span>
                  {!custom && draft && field in draft && (
                    <Button size="sm" variant="ghost" onClick={() => reset(field)}>
                      恢复{label}默认值
                    </Button>
                  )}
                </div>
                <Input
                  id={`${ids}-${field}`}
                  aria-label={label}
                  disabled={!draft}
                  type={field === "contextWindow" || field === "maxTokens" ? "number" : "text"}
                  value={scalar(effective[field])}
                  onChange={(event) =>
                    update(
                      field,
                      field === "contextWindow" || field === "maxTokens"
                        ? Number(event.target.value)
                        : event.target.value,
                    )
                  }
                />
              </Field>
            ))}
            <Field orientation="horizontal" className="gap-2">
              <Checkbox
                id={`${ids}-reasoning`}
                aria-label="推理能力"
                disabled={!draft}
                checked={effective.reasoning === true}
                onCheckedChange={(checked) => update("reasoning", checked)}
              />
              <FieldLabel htmlFor={`${ids}-reasoning`} className="font-normal">
                推理能力
              </FieldLabel>
            </Field>
            <FieldSet className="gap-2">
              <FieldLegend variant="label">输入能力</FieldLegend>
              <div className="flex gap-3">
                {["text", "image"].map((kind) => (
                  <Field key={kind} orientation="horizontal" className="w-auto gap-2">
                    <Checkbox
                      id={`${ids}-input-${kind}`}
                      aria-label={`输入 ${kind}`}
                      disabled={!draft}
                      checked={Array.isArray(effective.input) && effective.input.includes(kind)}
                      onCheckedChange={(checked) => {
                        const input = Array.isArray(effective.input) ? effective.input : [];
                        update(
                          "input",
                          checked ? [...input, kind] : input.filter((item) => item !== kind),
                        );
                      }}
                    />
                    <FieldLabel htmlFor={`${ids}-input-${kind}`} className="font-normal">
                      {kind}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible className="space-y-2">
          <CollapsibleTrigger className="group/collapsible-trigger focus-visible:ring-ring flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2">
            <ChevronRight
              className="size-4 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
              aria-hidden="true"
            />
            高级 JSON（{custom ? "完整模型定义" : "差异覆盖"}）
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2">
            <Field>
              <FieldLabel htmlFor={`${ids}-json`}>模型定义</FieldLabel>
              <Textarea
                id={`${ids}-json`}
                aria-label="模型高级 JSON"
                spellCheck={false}
                className="min-h-48 font-mono text-xs"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <FieldDescription>
                支持 compat、samplingParams、cost、headers 等字段。秘密 Header 仅填写 $
                {"{credential:entry}"} 引用，不能填写密钥。
              </FieldDescription>
            </Field>
          </CollapsibleContent>
        </Collapsible>
        {!draft && (
          <Alert variant="destructive">
            <AlertDescription>JSON 无效，请修正后使用表单或提交。</AlertDescription>
          </Alert>
        )}
        <Collapsible render={<section className="space-y-2" />}>
          <CollapsibleTrigger className="group/collapsible-trigger focus-visible:ring-ring flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2">
            <ChevronRight
              className="size-4 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
              aria-hidden="true"
            />
            查看最终有效配置（未解析凭据）
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="overflow-auto text-xs">{JSON.stringify(effective, null, 2)}</pre>
          </CollapsibleContent>
        </Collapsible>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button disabled={!draft} onClick={apply}>
          应用
        </Button>
      </DialogFooter>
    </>
  );
}
