import {
  type AppearanceSettings,
  HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES,
  type HorizontalScrollbarVisibility,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";

type SettingsAppearanceSectionProps = {
  appearance: AppearanceSettings;
  disabled: boolean;
  onUpdateAppearance: (updater: (current: AppearanceSettings) => AppearanceSettings) => void;
};

const horizontalScrollbarVisibilityLabels = {
  system: "System default",
  show: "Show",
  hide: "Hide",
} satisfies Record<HorizontalScrollbarVisibility, string>;

const horizontalScrollbarVisibilityOptions: {
  value: HorizontalScrollbarVisibility;
  label: string;
}[] = HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES.map((value) => ({
  value,
  label: horizontalScrollbarVisibilityLabels[value],
}));

const isHorizontalScrollbarVisibility = (value: string): value is HorizontalScrollbarVisibility =>
  HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES.includes(value as HorizontalScrollbarVisibility);

export function SettingsAppearanceSection({
  appearance,
  disabled,
  onUpdateAppearance,
}: SettingsAppearanceSectionProps): ReactElement {
  const labelId = "appearance-horizontal-scrollbars-label";
  const descriptionId = "appearance-horizontal-scrollbars-description";
  const selectedVisibility = appearance.horizontalScrollbarVisibility;
  const handleHorizontalScrollbarVisibilityChange = (value: string): void => {
    const horizontalScrollbarVisibility = value;
    if (
      horizontalScrollbarVisibility === selectedVisibility ||
      !isHorizontalScrollbarVisibility(horizontalScrollbarVisibility)
    ) {
      return;
    }

    onUpdateAppearance((current) => ({
      ...current,
      horizontalScrollbarVisibility,
    }));
  };

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Appearance</h3>
        <p className="text-xs text-muted-foreground">
          Configure display preferences that apply across OpenDucktor.
        </p>
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
        <div className="grid gap-2">
          <Label id={labelId}>Horizontal Scrollbars</Label>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            System default shows horizontal scrollbars on Windows and Linux, and hides them on
            macOS. Choose Show or Hide to override it on every platform.
          </p>
        </div>

        <div>
          <Combobox
            value={selectedVisibility}
            options={horizontalScrollbarVisibilityOptions}
            disabled={disabled}
            placeholder="Select visibility"
            searchPlaceholder="Search visibility..."
            emptyText="No visibility option found."
            triggerAriaLabelledBy={labelId}
            triggerAriaDescribedBy={descriptionId}
            triggerClassName="bg-card"
            onValueChange={handleHorizontalScrollbarVisibilityChange}
          />
        </div>
      </div>
    </div>
  );
}
