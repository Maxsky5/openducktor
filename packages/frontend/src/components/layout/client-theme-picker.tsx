import { themePreferenceSchema, type ThemePreference } from "@openducktor/contracts";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyThemeToDocument } from "./theme-dom";
import { ThemePicker } from "./theme-picker";
import {
  readSystemAppearance,
  resolveThemePreference,
  subscribeToSystemAppearance,
  THEME_PREFERENCE_LABELS,
} from "./theme-preference";

const CLIENT_THEME_KEY = "openducktor:client-theme";
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor };
type ThemeState = { preference: ThemePreference; error: string | null };

export function ClientThemePicker() {
  const [state, setState] = useState(readTheme);
  const Icon = THEME_ICONS[state.preference];
  const label = `Theme: ${THEME_PREFERENCE_LABELS[state.preference]}`;
  const appearance = useSyncExternalStore(subscribeToSystemAppearance, readSystemAppearance);
  useLayoutEffect(() => {
    applyThemeToDocument(resolveThemePreference(state.preference, appearance));
  }, [state.preference, appearance]);
  const select = (preference: ThemePreference) => {
    try {
      localStorage.setItem(CLIENT_THEME_KEY, preference);
      setState({ preference, error: null });
    } catch {
      setState({ ...state, error: "Could not save the theme. Allow site storage and try again." });
    }
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <ThemePicker
        value={state.preference}
        onValueChange={select}
        trigger={
          <Button type="button" variant="outline" size="icon" aria-label={label} title={label}>
            <Icon />
          </Button>
        }
      />
      {state.error ? (
        <p role="alert" className="max-w-xs text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

function readTheme(): ThemeState {
  try {
    const result = themePreferenceSchema.safeParse(
      localStorage.getItem(CLIENT_THEME_KEY) ?? "system",
    );
    if (result.success) return { preference: result.data, error: null };
    return {
      preference: "system",
      error: "The saved theme is invalid. Choose a theme to replace it.",
    };
  } catch {
    return {
      preference: "system",
      error: "Could not read the saved theme. Allow site storage and choose a theme.",
    };
  }
}
