import type { ThemePreference } from "@/device-data/device-records";

/** The theme choices of this device, in the order that the settings show them. */
export const THEME_PREFERENCES = [
  "system",
  "light",
  "dark",
] as const satisfies readonly ThemePreference[];
