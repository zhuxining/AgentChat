import { useState } from "react";

import type { Json, ProviderInstance, ProviderModel } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <section aria-label="模型编辑" className="space-y-3 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{model ? `编辑 ${model.name}` : "添加自定义模型"}</h3>
      <p className="text-muted-foreground text-xs">
        内置模型仅保存差异；未填写的字段继承目录。表单与高级 JSON 使用同一草稿。提交后请保存接入。
      </p>
      {custom && (
        <label className="block text-sm">
          模型 ID
          <Input
            aria-label="自定义模型 ID"
            value={scalar(effective.id)}
            disabled={!!model || !draft}
            onChange={(event) => update("id", event.target.value)}
          />
        </label>
      )}
      <label className="block text-sm">
        API 协议
        <select
          aria-label="模型 API 协议"
          className="bg-background h-9 w-full rounded-md border px-2"
          disabled={!draft}
          value={typeof effective.api === "string" ? effective.api : ""}
          onChange={(event) => update("api", event.target.value)}
        >
          <option value="">选择协议</option>
          {[
            ...new Set([
              ...apiOptions,
              ...(typeof effective.api === "string" && effective.api ? [effective.api] : []),
            ]),
          ].map((api) => (
            <option key={api} value={api}>
              {api}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["name", "模型名称"],
          ["baseUrl", "模型端点"],
          ["contextWindow", "上下文上限"],
          ["maxTokens", "输出上限"],
        ] as const
      ).map(([field, label]) => (
        <div className="block text-sm" key={field}>
          {label}
          <span className="text-muted-foreground ml-2 text-xs">
            {draft && field in draft ? "已覆盖" : "继承默认值"}
          </span>
          {!custom && draft && field in draft && (
            <Button size="sm" variant="ghost" onClick={() => reset(field)}>
              恢复{label}默认值
            </Button>
          )}
          <Input
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
        </div>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="推理能力"
          disabled={!draft}
          checked={effective.reasoning === true}
          onChange={(event) => update("reasoning", event.target.checked)}
        />
        推理能力
      </label>
      <fieldset className="flex gap-3 text-sm">
        <legend>输入能力</legend>
        {["text", "image"].map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              aria-label={`输入 ${kind}`}
              disabled={!draft}
              checked={Array.isArray(effective.input) && effective.input.includes(kind)}
              onChange={(event) => {
                const input = Array.isArray(effective.input) ? effective.input : [];
                update(
                  "input",
                  event.target.checked ? [...input, kind] : input.filter((item) => item !== kind),
                );
              }}
            />{" "}
            {kind}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1 text-sm">
        高级 JSON（{custom ? "完整模型定义" : "差异覆盖"}）
        <Textarea
          aria-label="模型高级 JSON"
          spellCheck={false}
          className="min-h-48 font-mono text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="text-muted-foreground text-xs">
        可编辑 compat、samplingParams、cost、headers 等全部可序列化字段。秘密 Header 仅填写 $
        {"{credential:entry}"} 引用，不能填写密钥。实际支持以对应协议为准。
      </p>
      {!draft && <p role="alert">JSON 无效，请修正后使用表单或提交。</p>}
      <details>
        <summary className="cursor-pointer text-sm">查看最终有效配置（未解析凭据）</summary>
        <pre className="overflow-auto text-xs">{JSON.stringify(effective, null, 2)}</pre>
      </details>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={!draft} onClick={apply}>
          应用模型草稿
        </Button>
        <Button variant="outline" onClick={onClose}>
          关闭模型编辑
        </Button>
      </div>
    </section>
  );
}
