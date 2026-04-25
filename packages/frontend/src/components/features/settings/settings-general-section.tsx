import type { ReactElement } from "react";

export function GeneralSettingsSection(): ReactElement {
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-foreground">General Settings</h3>
      <p className="text-sm text-muted-foreground">
        General application settings will live here. Repository-specific and prompt settings are now
        split into their dedicated sections.
      </p>
      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Settings are persisted in <code>~/.openducktor/config.json</code> and saved atomically.
      </div>
    </div>
  );
}
