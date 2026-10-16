import { SettingsSectionCard } from "@/features/settings/settings-layout";

export function GeneralSettings() {
  return (
    <SettingsSectionCard title="界面偏好">
      <p className="text-muted-foreground text-sm">
        主题与字号偏好尚未开放，当前使用应用默认外观与跟随系统的明暗主题。
      </p>
    </SettingsSectionCard>
  );
}
