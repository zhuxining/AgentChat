import { useId, useState } from "react";

import type { ConfigurationFile } from "@/app/runner-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRunnerActions } from "@/features/settings/use-runner-actions";

export function ConfigurationEditor({ files, disabled }: { files: string[]; disabled: boolean }) {
  const actions = useRunnerActions();
  const [path, setPath] = useState(files[0] ?? "");
  const [loaded, setLoaded] = useState<ConfigurationFile | null>(null);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  const canRead = files.includes(path);
  const canSave = loaded?.path === path && canRead && content !== loaded.content;

  async function read() {
    actions.clearError();
    setPending(true);
    setError("");
    try {
      const file = await actions.readConfiguration(path);
      setLoaded(file);
      setContent(file.content);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }

  async function save() {
    if (!loaded || !canSave) return;
    setPending(true);
    setError("");
    try {
      const saved = await actions.saveConfiguration(loaded.path, loaded.version, content);
      if (!saved) {
        setError("保存失败，草稿已保留。如文件被外部修改，请重新读取后再编辑。");
        return;
      }
      // Always fetch the new content version before permitting another save.
      setLoaded(null);
      const file = await actions.readConfiguration(loaded.path);
      setLoaded(file);
      setContent(file.content);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor={`${ids}-path`}>可编辑文件</FieldLabel>
        <NativeSelect
          id={`${ids}-path`}
          aria-label="配置文件路径"
          className="w-full"
          value={path}
          disabled={disabled || pending}
          onChange={(event) => {
            setPath(event.target.value);
            setLoaded(null);
            setContent("");
            setError("");
          }}
        >
          {files.map((file) => (
            <NativeSelectOption key={file} value={file}>
              {file}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          仅显示 Runner
          允许访问的配置文件。重新读取会丢弃当前草稿；保存会检查内容版本，防止覆盖外部编辑。
        </FieldDescription>
      </Field>
      <Button
        variant="outline"
        disabled={disabled || pending || !canRead}
        onClick={() => void read()}
      >
        {pending ? "正在处理…" : loaded ? "重新读取配置" : "读取配置"}
      </Button>
      {loaded && (
        <>
          <p className="text-muted-foreground text-xs break-all">
            文件：{loaded.path} · 内容版本：{loaded.version}
          </p>
          <Textarea
            aria-label="配置文件内容"
            className="min-h-56 font-mono text-xs"
            spellCheck={false}
            value={content}
            disabled={disabled || pending}
            onChange={(event) => setContent(event.target.value)}
          />
          <Button disabled={disabled || pending || !canSave} onClick={() => void save()}>
            保存配置文件
          </Button>
        </>
      )}
      <FieldDescription>
        JSON 配置中的凭据只填写 credentialRef 引用。API 密钥请使用 Provider
        页面的安全保存入口。保存并重载后的 Bot 配置用于后续执行；已有执行需显式应用。
      </FieldDescription>
      {(actions.error || error) && (
        <Alert variant="destructive">
          <AlertDescription>{actions.error || error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : typeof cause === "string"
      ? cause
      : "读取或保存配置失败，请重试。";
}
