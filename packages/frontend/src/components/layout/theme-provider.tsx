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
  const selectedThemeRef = useRef(theme);
  const pendingThemeRef = useRef<Theme | null>(null);
  const isPersistingRef = useRef(false);
  const optimisticSettingsSnapshotRef = useRef<SettingsSnapshot | null>(null);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (settingsSnapshot === optimisticSettingsSnapshotRef.current) {
      optimisticSettingsSnapshotRef.current = null;
      return;
    }

    optimisticSettingsSnapshotRef.current = null;
    persistedThemeRef.current = loadedTheme;
    if (isPersistingRef.current) {
      return;
    }

    selectedThemeRef.current = loadedTheme;
    selectOptimisticTheme(loadedTheme);
  }, [loadedTheme, settingsSnapshot]);

  const writeThemeToCache = useCallback(
    (newTheme: Theme): void => {
      const updatedSnapshot = queryClient.setQueryData(
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
      optimisticSettingsSnapshotRef.current = updatedSnapshot ?? null;
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
          writeThemeToCache(selectedThemeRef.current);
        } catch (error) {
          console.error("Failed to persist theme change.", error);
          if (pendingThemeRef.current === null) {
            selectedThemeRef.current = persistedThemeRef.current;
            writeThemeToCache(persistedThemeRef.current);
            applyThemeToDocument(persistedThemeRef.current);
            selectOptimisticTheme(persistedThemeRef.current);
            toast.error("Theme change failed", {
              description: errorMessage(error),
            });
          }
        }
      }
    } finally {
      isPersistingRef.current = false;
    }
  }, [writeThemeToCache]);

  const selectTheme = useCallback(
    (newTheme: Theme): void => {
      selectedThemeRef.current = newTheme;
      pendingThemeRef.current = newTheme;
      writeThemeToCache(newTheme);
      applyThemeToDocument(newTheme);
      selectOptimisticTheme(newTheme);
      void persistPendingThemes();
    },
    [persistPendingThemes, writeThemeToCache],
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
