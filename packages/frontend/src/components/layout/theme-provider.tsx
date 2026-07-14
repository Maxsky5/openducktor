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

type ConfirmedThemeState = {
  theme: Theme;
  isRefreshing: boolean;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);
const SETTINGS_SNAPSHOT_QUERY_KEY = settingsSnapshotQueryOptions().queryKey;
const replaceTheme = (_currentTheme: Theme, nextTheme: Theme): Theme => nextTheme;

export function ThemeProvider({ children, defaultTheme = "light", ...props }: ThemeProviderProps) {
  const queryClient = useQueryClient();
  const { data: settingsSnapshot, fetchStatus } = useQuery(settingsSnapshotQueryOptions());
  const fallbackTheme = useMemo(() => readDocumentTheme(defaultTheme), [defaultTheme]);
  const loadedTheme = settingsSnapshot?.theme ?? fallbackTheme;
  const [theme, selectOptimisticTheme] = useReducer(replaceTheme, loadedTheme);
  const persistedThemeRef = useRef(theme);
  const pendingThemeRef = useRef<Theme | null>(null);
  const isPersistingRef = useRef(false);
  const confirmedThemeRef = useRef<ConfirmedThemeState | null>(null);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const writePersistedThemeToCache = useCallback(
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

  const refreshSettingsSnapshot = useCallback(
    (confirmedTheme: Theme): void => {
      const confirmation = confirmedThemeRef.current;
      if (
        confirmation === null ||
        confirmation.theme !== confirmedTheme ||
        confirmation.isRefreshing
      ) {
        return;
      }

      confirmation.isRefreshing = true;
      void queryClient
        .fetchQuery({ ...settingsSnapshotQueryOptions(), staleTime: 0 })
        .catch((error: unknown) => {
          console.error("Failed to refresh settings after persisting the theme.", error);
        })
        .finally(() => {
          if (confirmedThemeRef.current?.theme === confirmedTheme) {
            confirmedThemeRef.current = null;
          }
        });
    },
    [queryClient],
  );

  useEffect(() => {
    const confirmation = confirmedThemeRef.current;
    if (confirmation !== null) {
      if (settingsSnapshot === undefined) {
        return;
      }
      if (loadedTheme !== confirmation.theme) {
        writePersistedThemeToCache(confirmation.theme);
        refreshSettingsSnapshot(confirmation.theme);
        return;
      }
      if (fetchStatus !== "idle" || confirmation.isRefreshing) {
        return;
      }
      confirmedThemeRef.current = null;
    }

    persistedThemeRef.current = loadedTheme;
    if (isPersistingRef.current) {
      return;
    }

    selectOptimisticTheme(loadedTheme);
  }, [
    fetchStatus,
    loadedTheme,
    refreshSettingsSnapshot,
    settingsSnapshot,
    writePersistedThemeToCache,
  ]);

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
        } catch (error) {
          console.error("Failed to persist theme change.", error);
          if (pendingThemeRef.current === null) {
            applyThemeToDocument(persistedThemeRef.current);
            selectOptimisticTheme(persistedThemeRef.current);
            toast.error("Theme change failed", {
              description: errorMessage(error),
            });
          }
          continue;
        }

        persistedThemeRef.current = nextTheme;
        confirmedThemeRef.current = { theme: nextTheme, isRefreshing: false };
        const cachedSnapshot = queryClient.getQueryData<SettingsSnapshot>(
          SETTINGS_SNAPSHOT_QUERY_KEY,
        );
        writePersistedThemeToCache(nextTheme);
        if (
          cachedSnapshot === undefined &&
          queryClient.getQueryState(SETTINGS_SNAPSHOT_QUERY_KEY)?.fetchStatus !== "fetching"
        ) {
          refreshSettingsSnapshot(nextTheme);
        }
      }
    } finally {
      isPersistingRef.current = false;
    }
  }, [queryClient, refreshSettingsSnapshot, writePersistedThemeToCache]);

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
