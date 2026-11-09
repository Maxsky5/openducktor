import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { keyboardShortcutsQueryOptions } from "@openducktor/frontend-core/queries/keyboard-shortcuts";
import type { ShortcutPreferences } from "@openducktor/contracts";
export function useShortcutPreferences() {
  const host = useHostClient();
  const client = useQueryClient();
  const options = keyboardShortcutsQueryOptions();
  const query = useQuery(options);
  const save = useMutation({
    mutationFn: (preferences: ShortcutPreferences) =>
      host.workspaceSaveKeyboardShortcuts(preferences),
    onSuccess: (preferences) => client.setQueryData(options.queryKey, preferences),
  });
  return { query, save };
}
