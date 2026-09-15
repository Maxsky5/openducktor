import { THEME_PREFERENCE_VALUES, type ThemePreference } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Combobox } from "@/components/ui/combobox";

type ThemePickerProps = {
  disabled?: boolean;
  triggerAriaLabelledBy?: string;
  triggerAriaDescribedBy?: string;
  triggerClassName?: string;
};

const themePreferenceLabels = {
  system: "System default",
  light: "Light",
  dark: "Dark",
} satisfies Record<ThemePreference, string>;

const themePreferenceOptions: { value: ThemePreference; label: string }[] =
  THEME_PREFERENCE_VALUES.map((value) => ({ value, label: themePreferenceLabels[value] }));

const isThemePreference = (value: string): value is ThemePreference =>
  THEME_PREFERENCE_VALUES.some((candidate) => candidate === value);

export function ThemePicker({
  disabled = false,
  triggerAriaLabelledBy,
  triggerAriaDescribedBy,
  triggerClassName,
}: ThemePickerProps): ReactElement {
  const { themePreference, setThemePreference } = useTheme();

  const handleChange = (value: string): void => {
    if (value === themePreference || !isThemePreference(value)) {
      return;
    }

    setThemePreference(value);
  };

  return (
    <Combobox
      value={themePreference}
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
