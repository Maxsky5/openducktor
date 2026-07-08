import {
  type AppearanceSettings,
  HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES,
  type HorizontalScrollbarVisibility,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  type SettingsSegmentedOption,
  SettingsSegmentedOptionRow,
} from "./settings-segmented-option-row";

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

const horizontalScrollbarVisibilityOptions: SettingsSegmentedOption<HorizontalScrollbarVisibility>[] =
  HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES.map((value) => ({
    value,
    label: horizontalScrollbarVisibilityLabels[value],
  }));

export function SettingsAppearanceSection({
  appearance,
  disabled,
  onUpdateAppearance,
}: SettingsAppearanceSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Appearance</h3>
        <p className="text-xs text-muted-foreground">
          Configure display preferences that apply across OpenDucktor.
        </p>
      </div>

      <SettingsSegmentedOptionRow<HorizontalScrollbarVisibility>
        title="Horizontal Scrollbars"
        description="Choose how supported horizontal scroll areas, starting with Kanban, handle app-level scrollbar hiding."
        value={appearance.horizontalScrollbarVisibility}
        options={horizontalScrollbarVisibilityOptions}
        disabled={disabled}
        onValueChange={(horizontalScrollbarVisibility) =>
          onUpdateAppearance((current) => ({
            ...current,
            horizontalScrollbarVisibility,
          }))
        }
      />
    </div>
  );
}
