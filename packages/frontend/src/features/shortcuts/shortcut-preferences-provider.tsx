import { useEffect, useState, type PropsWithChildren } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { keyboardShortcutsQueryOptions } from "@openducktor/frontend-core/queries/keyboard-shortcuts";
import type { ShortcutPreferences } from "@openducktor/contracts";
import { ShortcutPreferencesContext } from "./use-shortcut-preferences";

/** One preference read and update subscription for the current host connection tree. */
export function ShortcutPreferencesProvider({ children }: PropsWithChildren) {
  const host = useHostConnection();
  const client = useQueryClient();
  const options = keyboardShortcutsQueryOptions();
  const query = useQuery(options);
  const save = useMutation({
    mutationFn: (preferences: ShortcutPreferences) =>
      host.client.workspaceSaveKeyboardShortcuts(preferences),
    onSuccess: (preferences) => client.setQueryData(options.queryKey, preferences),
  });
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    void host
      .subscribeRunEvents((event) => {
        if (
          ("type" in event && event.type === "keyboard_shortcuts_saved") ||
          ("__openducktorConnectionControl" in event &&
            event.kind === "reconnected" &&
            event.missedEvents)
        ) {
          return client.invalidateQueries({
            queryKey: keyboardShortcutsQueryOptions().queryKey,
            exact: true,
          });
        }
      })
      .then(
        (stop) => {
          if (disposed) stop();
          else release = stop;
        },
        (cause) => {
          if (!disposed)
            setUpdatesError(
              `Shortcut updates are unavailable. Reload the app to reconnect. ${String(cause)}`,
            );
        },
      );
    return () => {
      disposed = true;
      release?.();
    };
  }, [host, client]);
  return (
    <ShortcutPreferencesContext value={{ query, save, updatesError }}>
      {children}
    </ShortcutPreferencesContext>
  );
}
