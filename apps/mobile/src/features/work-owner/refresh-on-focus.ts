import type { GitRefresh } from "@openducktor/frontend-core/git/refresh/use-git-refresh";

/**
 * Starts the soft refresh of a screen that gained focus. A screen that shows no changes gets no
 * refresh, and reads that did not load yet read by themselves.
 */
export const refreshOnFocus = ({
  enabled,
  loaded,
  refresh,
}: {
  enabled: boolean;
  loaded: boolean;
  refresh: GitRefresh;
}): void => {
  if (!enabled || !loaded) return;
  // Each view shows its own failed read.
  refresh("soft").catch(() => undefined);
};
