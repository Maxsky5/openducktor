import type { Theme, ThemePreference } from "@openducktor/contracts";

const DARK_APPEARANCE_QUERY = "(prefers-color-scheme: dark)";

const systemAppearanceQuery = (): MediaQueryList | null => {
  if (globalThis.matchMedia === undefined) {
    return null;
  }

  return globalThis.matchMedia(DARK_APPEARANCE_QUERY);
};

export const readSystemAppearance = (): Theme =>
  systemAppearanceQuery()?.matches === true ? "dark" : "light";

export const subscribeToSystemAppearance = (
  onChange: (appearance: Theme) => void,
): (() => void) => {
  const query = systemAppearanceQuery();
  if (query === null) {
    return () => {};
  }

  const handleChange = (event: MediaQueryListEvent): void => {
    onChange(event.matches ? "dark" : "light");
  };

  query.addEventListener("change", handleChange);
  return () => {
    query.removeEventListener("change", handleChange);
  };
};

export const resolveThemePreference = (
  preference: ThemePreference,
  systemAppearance: Theme,
): Theme => (preference === "system" ? systemAppearance : preference);
