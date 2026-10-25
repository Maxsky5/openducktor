import type { ReactElement } from "react";
import { useDevicePreferences, useDevicePreferencesActions } from "@/app-shell/app-services";
import type { ThemePreference } from "@/device-data/device-records";
import { ActionMenu } from "@/ui/action-menu";
import type { IconName } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { THEME_PREFERENCES } from "./theme-preference";

/** The desktop theme names (`theme-preference.ts`). */
const THEME_PREFERENCE_LABELS = {
  system: "System default",
  light: "Light",
  dark: "Dark",
} satisfies Record<ThemePreference, string>;

/** The desktop theme icons (`client-theme-picker.tsx`). */
const THEME_ICONS = {
  system: "monitor",
  light: "sun",
  dark: "moon",
} satisfies Record<ThemePreference, IconName>;

/**
 * The desktop client theme picker: an outlined icon control that shows the current theme and
 * opens the three choices. It changes the theme of this device.
 */
export function ThemeMenuButton(): ReactElement {
  const current = useDevicePreferences((state) => state.preferences.theme);
  const { update } = useDevicePreferencesActions();
  const label = THEME_PREFERENCE_LABELS[current];
  return (
    <ActionMenu
      title="Theme"
      items={THEME_PREFERENCES.map((value) => ({
        id: value,
        title: THEME_PREFERENCE_LABELS[value],
        icon: THEME_ICONS[value],
        checked: value === current,
      }))}
      onSelect={(id) => {
        const theme = THEME_PREFERENCES.find((value) => value === id);
        if (theme) update({ theme });
      }}
    >
      <IconButton
        icon={THEME_ICONS[current]}
        variant="outline"
        accessibilityLabel={`Theme: ${label}`}
        onPress={() => {}}
      />
    </ActionMenu>
  );
}
