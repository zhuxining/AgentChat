import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { runnerClient, type ProviderInstance, type ProviderModel } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ModelEditor } from "@/features/settings/model-editor";

export function ProviderModels({
  instance,
  saved,
  models,
  apis,
  onChange,
  allowBuiltinEditing = false,
}: {
  instance: ProviderInstance;
  saved: boolean;
  models: ProviderModel[];
  apis: string[];
  allowBuiltinEditing?: boolean;
  onChange: (instance: ProviderInstance) => void;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProviderModel | "new" | null>(null);
  const needle = search.toLowerCase();
  const searchQuery = useQuery({
    queryKey: ["provider-settings", "model-search", instance.id, saved, search],
    queryFn: () =>
      runnerClient.providerRequest({
        action: "list",
        ...(saved ? { instanceId: instance.id } : { type: instance.type }),
        search,
      }),
    enabled: !!search.trim(),
    retry: false,
  });
  const matchingModels = search.trim() ? (searchQuery.data?.models ?? []) : models;
  // Include unsaved custom models without maintaining a second model catalog.
  const custom = instance.customModels.flatMap((definition): ProviderModel[] =>
    typeof definition.id === "string"
      ? [
          {
            id: definition.id,
            name: typeof definition.name === "string" ? definition.name : definition.id,
            custom: true,
            overridden: false,
            visible: instance.visibleModels.includes(definition.id),
            definition,
          },
        ]
      : [],
  );
  const all = [...matchingModels.filter((model) => !model.custom), ...custom];
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          aria-label="搜索模型"
          placeholder="搜索模型名称或 ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button variant="outline" onClick={() => setEditing("new")}>
          添加自定义模型
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">勾选后，模型会出现在 Bot 选择器中。</p>
      {!instance.visibleModels.length && (
        <p role="status" className="text-sm">
          尚未选择 Bot 可用模型。
        </p>
      )}
      {editing && (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <ModelEditor
              key={editing === "new" ? "new" : editing.id}
              instance={instance}
              model={editing === "new" ? null : editing}
              template={models[0]?.defaults ?? models[0]?.definition}
              apiOptions={[
                ...new Set([
                  ...apis,
                  ...models.flatMap((model) =>
                    typeof model.definition.api === "string" ? [model.definition.api] : [],
                  ),
                ]),
              ]}
              onChange={onChange}
              onClose={() => setEditing(null)}
            />
          </DialogContent>
        </Dialog>
      )}
      {searchQuery.isFetching && (
        <p role="status" className="text-sm">
          正在搜索模型…
        </p>
      )}
      {searchQuery.error && (
        <Alert variant="destructive">
          <AlertDescription>模型搜索失败，请重试。</AlertDescription>
        </Alert>
      )}
      <ul className="max-h-96 space-y-2 overflow-auto" aria-label="模型目录">
        {all
          .filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(needle))
          .map((model) => (
            <li key={model.id}>
              <Item variant="outline" className="flex-col items-stretch">
                <div className="flex items-center gap-2">
                  <ItemMedia>
                    <Checkbox
                      aria-label={`在 Bot 中显示 ${model.id}`}
                      checked={instance.visibleModels.includes(model.id)}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...instance,
                          visibleModels: checked
                            ? [...instance.visibleModels, model.id]
                            : instance.visibleModels.filter((id) => id !== model.id),
                        })
                      }
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{model.name}</ItemTitle>
                    <ItemDescription className="text-xs">
                      {model.id} ·{" "}
                      {model.custom
                        ? "自定义"
                        : instance.modelOverrides[model.id]
                          ? "已覆盖"
                          : "内置默认"}
                    </ItemDescription>
                  </ItemContent>
                  {(model.custom || allowBuiltinEditing) && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`编辑模型 ${model.id}`}
                      onClick={() => setEditing(model)}
                    >
                      配置模型
                    </Button>
                  )}
                </div>
                {!model.custom && instance.modelOverrides[model.id] && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const overrides = { ...instance.modelOverrides };
                      delete overrides[model.id];
                      onChange({ ...instance, modelOverrides: overrides });
                      setEditing(null);
                    }}
                  >
                    恢复 {model.id} 内置默认值
                  </Button>
                )}
                {model.custom && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onChange({
                        ...instance,
                        customModels: instance.customModels.filter((item) => item.id !== model.id),
                        visibleModels: instance.visibleModels.filter((id) => id !== model.id),
                      });
                      setEditing(null);
                    }}
                  >
                    删除自定义模型 {model.id}
                  </Button>
                )}
              </Item>
            </li>
          ))}
      </ul>
      {all.length === 0 && (
        <p className="text-muted-foreground text-sm">目录为空，可以添加自定义模型。</p>
      )}
    </div>
  );
}
