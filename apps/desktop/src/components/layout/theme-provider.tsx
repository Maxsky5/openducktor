import type { SettingsSnapshot, Theme } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createHostClient } from "@/lib/host-client";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { applyThemeToDocument, readDocumentTheme } from "./theme-dom";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "light",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const hostClient = createHostClient();

export function ThemeProvider({ children, defaultTheme = "light", ...props }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readDocumentTheme(defaultTheme));
  const queryClient = useQueryClient();
  const { data: settingsSnapshot } = useQuery(settingsSnapshotQueryOptions());

  useEffect(() => {
    if (!settingsSnapshot) {
      return;
    }

    const resolved = settingsSnapshot.theme === "dark" ? "dark" : "light";
    setThemeState((current: Theme) => (current === resolved ? current : resolved));
  }, [settingsSnapshot]);

  useLayoutEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: (newTheme: Theme) => {
        const previousTheme = theme;
        const previousSnapshot = queryClient.getQueryData<SettingsSnapshot>(
          settingsSnapshotQueryOptions().queryKey,
        );
        setThemeState(newTheme);
        queryClient.setQueryData(
          settingsSnapshotQueryOptions().queryKey,
          (current: SettingsSnapshot | undefined) => {
            if (!current) {
              return current;
            }

            return {
              ...current,
              theme: newTheme,
            };
          },
        );
        void hostClient.setTheme(newTheme).catch((error) => {
          console.error("Failed to persist theme change.", error);
          setThemeState(previousTheme);
          if (previousSnapshot) {
            queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, previousSnapshot);
          }
        });
      },
    }),
    [queryClient, theme],
  );

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
