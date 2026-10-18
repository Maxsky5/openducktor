import { THEME_PREFERENCE_VALUES, type ThemePreference } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { THEME_PREFERENCE_LABELS } from "@/components/layout/theme-preference";
import { Combobox } from "@/components/ui/combobox";

type ThemePickerProps = {
  trigger?: ReactElement;
  value: ThemePreference;
  onValueChange(preference: ThemePreference): void;
  disabled?: boolean;
  triggerAriaLabelledBy?: string;
  triggerAriaDescribedBy?: string;
  triggerClassName?: string;
};

const themePreferenceOptions: { value: ThemePreference; label: string }[] =
  THEME_PREFERENCE_VALUES.map((value) => ({ value, label: THEME_PREFERENCE_LABELS[value] }));

const isThemePreference = (value: string): value is ThemePreference =>
  THEME_PREFERENCE_VALUES.some((candidate) => candidate === value);

export function ThemePicker({
  trigger,
  value,
  onValueChange,
  disabled = false,
  triggerAriaLabelledBy,
  triggerAriaDescribedBy,
  triggerClassName,
}: ThemePickerProps): ReactElement {
  const handleChange = (nextValue: string): void => {
    if (nextValue === value || !isThemePreference(nextValue)) {
      return;
    }

    onValueChange(nextValue);
  };

  return (
    <Combobox
      {...(trigger ? { trigger } : {})}
      className="min-w-44"
      value={value}
      options={themePreferenceOptions}
      disabled={disabled}
      searchable={false}
      placeholder="Select theme"
      {...(triggerAriaLabelledBy === undefined ? {} : { triggerAriaLabelledBy })}
      {...(triggerAriaDescribedBy === undefined ? {} : { triggerAriaDescribedBy })}
      {...(triggerClassName === undefined ? {} : { triggerClassName })}
      onValueChange={handleChange}
    />
  );
}
