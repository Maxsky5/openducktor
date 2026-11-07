import { Compass } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { SettingsAppUpdatesSection } from "@/components/features/app-updates/settings-app-updates-section";
import { useFeatureTour } from "@/features/feature-tour/feature-tour-context";
import { type SettingsDialogHandoff, useSettingsDialogHandoff } from "./settings-modal-context";

type GeneralSettingsSectionProps = {
  disabled: boolean;
};

export function GeneralSettingsSection({ disabled }: GeneralSettingsSectionProps): ReactElement {
  // Only the shared Settings can give its place to the tour. Its provider sits inside the tour one.
  const handoff = useSettingsDialogHandoff();
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">General settings</h3>
        <p className="text-xs text-muted-foreground">
          Manage OpenDucktor updates and shared settings.
        </p>
      </div>

      <SettingsAppUpdatesSection disabled={disabled} />

      {handoff ? <FeatureTourRow disabled={disabled} handoff={handoff} /> : null}

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        OpenDucktor saves shared settings to the host database <code>database.sqlite</code> in its
        config folder. <code>config.json</code> in the same folder keeps the personal preferences of
        this host.
      </div>
    </div>
  );
}

type FeatureTourRowProps = {
  disabled: boolean;
  handoff: SettingsDialogHandoff;
};

function FeatureTourRow({ disabled, handoff }: FeatureTourRowProps): ReactElement {
  const { openFeatureTour } = useFeatureTour();
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Feature tour</h3>
        <p className="text-xs text-muted-foreground">See the main parts of OpenDucktor again.</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => handoff(openFeatureTour)}
      >
        <Compass data-icon="inline-start" />
        Show tour
      </Button>
    </div>
  );
}
