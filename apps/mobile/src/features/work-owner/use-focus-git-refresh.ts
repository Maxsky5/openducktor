import type { GitRefresh } from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * The soft Git refresh that a screen that shows changes runs each time it gains navigation focus,
 * also on a new visit and when a sheet above it closes. Pass it to `useFocusEffect`, which runs it
 * with no render. Work views keep their Git reads until a refresh, and the host sends no file event
 * for an edit in a terminal or an editor. This is the mobile form of the desktop window focus
 * refresh. Reads that did not load yet read by themselves, so they get no refresh.
 */
export function useFocusGitRefresh({
  enabled,
  loaded,
  refresh,
}: {
  enabled: boolean;
  loaded: boolean;
  refresh: GitRefresh;
}): () => void {
  // A read that loads while the screen has focus gets no refresh, so only `enabled` changes the
  // callback that `useFocusEffect` runs.
  const latest = useRef({ loaded, refresh });
  useLayoutEffect(() => {
    latest.current = { loaded, refresh };
  });
  return useCallback(() => {
    const current = latest.current;
    if (!enabled || !current.loaded) return;
    // Each view shows its own failed read.
    current.refresh("soft").catch(() => undefined);
  }, [enabled]);
}
