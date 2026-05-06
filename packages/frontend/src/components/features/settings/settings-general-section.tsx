import type { GeneralSettings } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Switch } from "@/components/ui/switch";

type GeneralSettingsSectionProps = {
  general: GeneralSettings;
  disabled: boolean;
  onUpdateGeneral: (updater: (current: GeneralSettings) => GeneralSettings) => void;
};

export function GeneralSettingsSection({
  general,
  disabled,
  onUpdateGeneral,
}: GeneralSettingsSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">General Settings</h3>
        <p className="text-xs text-muted-foreground">
          Configure application-wide behavior for OpenDucktor.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Open Agent Studio tab for background sessions
            </p>
            <p className="text-xs text-muted-foreground">
              When enabled, starting a task session in the background adds that task to Agent Studio
              tabs without navigating away from Kanban.
            </p>
          </div>
          <Switch
            checked={general.openAgentStudioTabOnBackgroundSessionStart}
            onCheckedChange={(checked) =>
              onUpdateGeneral((current) => ({
                ...current,
                openAgentStudioTabOnBackgroundSessionStart: checked,
              }))
            }
            disabled={disabled}
            aria-label="Open Agent Studio tab for background sessions"
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Settings are persisted in <code>~/.openducktor/config.json</code> and saved atomically.
      </div>
    </div>
  );
}
