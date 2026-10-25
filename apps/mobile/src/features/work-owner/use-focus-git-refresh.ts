import type { GitRefresh } from "@openducktor/frontend-core/git/refresh/use-git-refresh";
import { useEffect, useEffectEvent } from "react";

/**
 * Refreshes Git softly each time a screen that shows changes gains navigation focus, also on a new
 * visit. Work views keep their Git reads until a refresh, and the host sends no file event for an
 * edit in a terminal or an editor. This is the mobile form of the desktop window focus refresh.
 * Reads that did not load yet read by themselves, so they get no refresh.
 */
export function useFocusGitRefresh({
  focused,
  loaded,
  refresh,
}: {
  focused: boolean;
  loaded: boolean;
  refresh: GitRefresh;
}): void {
  const refreshOnFocus = useEffectEvent(() => {
    if (!loaded) return;
    // Each view shows its own failed read.
    refresh("soft").catch(() => undefined);
  });
  useEffect(() => {
    if (focused) refreshOnFocus();
  }, [focused]);
}
