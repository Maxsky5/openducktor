import { createContext, use } from "react";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import type { ShortcutPreferences } from "@openducktor/contracts";

export const ShortcutPreferencesContext = createContext<{
  query: UseQueryResult<ShortcutPreferences, Error>;
  save: UseMutationResult<ShortcutPreferences, Error, ShortcutPreferences>;
  updatesError: string | null;
} | null>(null);

export function useShortcutPreferences() {
  const preferences = use(ShortcutPreferencesContext);
  if (!preferences) throw new Error("Shortcut preferences require ShortcutPreferencesProvider.");
  return preferences;
}
