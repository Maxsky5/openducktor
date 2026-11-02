import type { ReactElement } from "react";
import { SettingsAppUpdatesSection } from "@/components/features/app-updates/settings-app-updates-section";

type GeneralSettingsSectionProps = {
  disabled: boolean;
};

export function GeneralSettingsSection({ disabled }: GeneralSettingsSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">General settings</h3>
        <p className="text-xs text-muted-foreground">
          Manage OpenDucktor updates and shared settings.
        </p>
      </div>

      <SettingsAppUpdatesSection disabled={disabled} />

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        OpenDucktor saves settings to <code>config.json</code> in its config folder.
      </div>
    </div>
  );
}
