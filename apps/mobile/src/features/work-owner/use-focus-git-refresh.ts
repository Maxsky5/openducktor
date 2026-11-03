import type { GitRefresh } from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import { useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useRef } from "react";
import { refreshOnFocus } from "./refresh-on-focus";

/**
 * Refreshes Git softly each time a screen that shows changes gains navigation focus, also on a new
 * visit and when a sheet above it closes. `useFocusEffect` runs the refresh with no render. Work
 * views keep their Git reads until a refresh, and the host sends no file event for an edit in a
 * terminal or an editor. This is the mobile form of the desktop window focus refresh.
 */
export function useFocusGitRefresh({
  enabled,
  loaded,
  refresh,
}: {
  enabled: boolean;
  loaded: boolean;
  refresh: GitRefresh;
}): void {
  // A read that loads while the screen has focus gets no refresh, so only `enabled` changes the
  // focus effect.
  const latest = useRef({ loaded, refresh });
  useLayoutEffect(() => {
    latest.current = { loaded, refresh };
  }, [loaded, refresh]);
  useFocusEffect(
    useCallback(() => {
      refreshOnFocus({ enabled, ...latest.current });
    }, [enabled]),
  );
}
