import type { SettingsSnapshot, Theme } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { hostBridge } from "@/lib/host-client";
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

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({ children, defaultTheme = "light", ...props }: ThemeProviderProps) {
  const queryClient = useQueryClient();
  const { data: settingsSnapshot } = useQuery(settingsSnapshotQueryOptions());
  const fallbackTheme = useMemo(() => readDocumentTheme(defaultTheme), [defaultTheme]);
  const theme =
    settingsSnapshot?.theme === "dark" ? "dark" : (settingsSnapshot?.theme ?? fallbackTheme);

  useEffect(() => {
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
        applyThemeToDocument(newTheme);
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
        void hostBridge.client.setTheme(newTheme).catch((error) => {
          console.error("Failed to persist theme change.", error);
          applyThemeToDocument(previousTheme);
          if (previousSnapshot) {
            queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, previousSnapshot);
          }
          toast.error("Theme change failed", {
            description: errorMessage(error),
          });
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
  const context = use(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
