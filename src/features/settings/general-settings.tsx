import { useId } from "react";

import { isTheme, useTheme } from "@/app/theme";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SettingsSectionCard } from "@/features/settings/settings-layout";

export function GeneralSettings() {
  const { theme, setTheme, storageError } = useTheme();
  const id = useId();

  return (
    <SettingsSectionCard title="界面偏好">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <FieldLabel htmlFor={id}>外观</FieldLabel>
        </div>
        <NativeSelect
          id={id}
          value={theme}
          className="w-full sm:w-40"
          onChange={(event) => {
            if (isTheme(event.target.value)) setTheme(event.target.value);
          }}
        >
          <NativeSelectOption value="system">跟随系统</NativeSelectOption>
          <NativeSelectOption value="light">浅色</NativeSelectOption>
          <NativeSelectOption value="dark">深色</NativeSelectOption>
        </NativeSelect>
      </div>
      {storageError && (
        <p role="alert" className="text-danger text-sm">
          {storageError}
        </p>
      )}
    </SettingsSectionCard>
  );
}
