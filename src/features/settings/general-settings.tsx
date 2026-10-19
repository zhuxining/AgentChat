import { useId } from "react";

import { isTheme, useTheme } from "@/app/theme";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SettingsSectionCard } from "@/features/settings/settings-layout";

export function GeneralSettings() {
  const { theme, setTheme, storageError } = useTheme();
  const id = useId();

  return (
    <SettingsSectionCard title="界面偏好">
      <Field>
        <FieldLabel htmlFor={id}>主题</FieldLabel>
        <NativeSelect
          id={id}
          value={theme}
          onChange={(event) => {
            if (isTheme(event.target.value)) setTheme(event.target.value);
          }}
        >
          <NativeSelectOption value="system">跟随系统</NativeSelectOption>
          <NativeSelectOption value="light">浅色</NativeSelectOption>
          <NativeSelectOption value="dark">深色</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>立即生效并自动保存。跟随系统时，自动同步系统明暗主题。</FieldDescription>
      </Field>
      {storageError && (
        <p role="alert" className="text-danger text-sm">
          {storageError}
        </p>
      )}
    </SettingsSectionCard>
  );
}
