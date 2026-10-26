import { createContext, type PropsWithChildren, type ReactElement, use, useMemo } from "react";
// The one place that follows the theme with `useUnistyles`.
// oxlint-disable-next-line no-restricted-imports
import { UnistylesRuntime, useUnistyles } from "react-native-unistyles";
import type { AppTheme } from "./tokens";

const AppThemeContext = createContext<AppTheme | null>(null);

/**
 * Gives the current theme to the views that need theme values outside styles, such as the
 * underlay color of a control or the color of a spinner. Only this provider follows the theme
 * with `useUnistyles`, so a list row reads the theme from context and adds no Unistyles listener.
 * The app changes the theme only by its name, so the value changes only with the name.
 */
export function AppThemeProvider({ children }: PropsWithChildren): ReactElement {
  const { themeName } = useUnistyles().rt;
  const theme = useMemo(() => UnistylesRuntime.getTheme(themeName), [themeName]);
  return <AppThemeContext value={theme}>{children}</AppThemeContext>;
}

/** The current theme, for values outside styles. Styles read the theme in `StyleSheet.create`. */
export const useAppTheme = (): AppTheme => {
  const theme = use(AppThemeContext);
  if (!theme) throw new Error("useAppTheme needs an AppThemeProvider above it.");
  return theme;
};
