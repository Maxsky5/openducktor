import {
  type AppearanceSettings,
  HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES,
  type HorizontalScrollbarVisibility,
} from "@openducktor/contracts";
import { ChevronDown } from "lucide-react";
import type { ChangeEvent, ReactElement } from "react";
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
  const selectId = "appearance-horizontal-scrollbars";
  const labelId = "appearance-horizontal-scrollbars-label";
  const descriptionId = "appearance-horizontal-scrollbars-description";
  const selectedVisibility = appearance.horizontalScrollbarVisibility;
  const handleHorizontalScrollbarVisibilityChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    if (disabled) {
      return;
    }

    const horizontalScrollbarVisibility = event.currentTarget.value;
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
          <Label id={labelId} htmlFor={selectId}>
            Horizontal Scrollbars
          </Label>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            System default shows horizontal scrollbars on Windows and Linux, and hides them on
            macOS. Choose Show or Hide to override it on every platform.
          </p>
        </div>

        <div className="relative">
          <select
            id={selectId}
            value={selectedVisibility}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            className="h-9 w-full appearance-none rounded-md border border-input bg-card px-3 py-1 pr-9 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={handleHorizontalScrollbarVisibilityChange}
          >
            {horizontalScrollbarVisibilityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
