import type { SettingsSnapshot, Theme } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
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
const SETTINGS_SNAPSHOT_QUERY_KEY = settingsSnapshotQueryOptions().queryKey;
const replaceTheme = (_currentTheme: Theme, nextTheme: Theme): Theme => nextTheme;

export function ThemeProvider({ children, defaultTheme = "light", ...props }: ThemeProviderProps) {
  const queryClient = useQueryClient();
  const { data: settingsSnapshot } = useQuery(settingsSnapshotQueryOptions());
  const fallbackTheme = useMemo(() => readDocumentTheme(defaultTheme), [defaultTheme]);
  const loadedTheme = settingsSnapshot?.theme ?? fallbackTheme;
  const [theme, selectOptimisticTheme] = useReducer(replaceTheme, loadedTheme);
  const persistedThemeRef = useRef(theme);
  const pendingThemeRef = useRef<Theme | null>(null);
  const isPersistingRef = useRef(false);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    persistedThemeRef.current = loadedTheme;
    if (isPersistingRef.current) {
      return;
    }

    selectOptimisticTheme(loadedTheme);
  }, [loadedTheme]);

  const writeThemeToCache = useCallback(
    (newTheme: Theme): void => {
      queryClient.setQueryData(
        SETTINGS_SNAPSHOT_QUERY_KEY,
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
    },
    [queryClient],
  );

  const persistPendingThemes = useCallback(async (): Promise<void> => {
    if (isPersistingRef.current) {
      return;
    }

    isPersistingRef.current = true;
    try {
      while (pendingThemeRef.current !== null) {
        const nextTheme = pendingThemeRef.current;
        pendingThemeRef.current = null;

        if (nextTheme === persistedThemeRef.current) {
          continue;
        }

        try {
          await hostBridge.client.setTheme(nextTheme);
          persistedThemeRef.current = nextTheme;
          writeThemeToCache(nextTheme);
        } catch (error) {
          console.error("Failed to persist theme change.", error);
          if (pendingThemeRef.current === null) {
            applyThemeToDocument(persistedThemeRef.current);
            selectOptimisticTheme(persistedThemeRef.current);
          }
          toast.error("Theme change failed", {
            description: errorMessage(error),
          });
        }
      }
    } finally {
      isPersistingRef.current = false;
    }
  }, [writeThemeToCache]);

  const selectTheme = useCallback(
    (newTheme: Theme): void => {
      pendingThemeRef.current = newTheme;
      applyThemeToDocument(newTheme);
      selectOptimisticTheme(newTheme);
      void persistPendingThemes();
    },
    [persistPendingThemes],
  );

  const value = useMemo(() => ({ theme, setTheme: selectTheme }), [selectTheme, theme]);

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
