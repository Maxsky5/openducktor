import { StyleSheet } from "react-native-unistyles";
import { darkTheme, lightTheme } from "./tokens";

export const breakpoints = { xs: 0, sm: 380, md: 600, lg: 900, xl: 1200 } as const;

type AppThemes = { light: typeof lightTheme; dark: typeof darkTheme };
type AppBreakpoints = typeof breakpoints;

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes: { light: lightTheme, dark: darkTheme },
  breakpoints,
  settings: { adaptiveThemes: true },
});
