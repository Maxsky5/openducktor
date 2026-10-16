import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type { GitDiffRefreshMode } from "../contracts";
import {
  type GitFileRefresh,
  GitRefreshCoordinator,
  type GitRefreshView,
  manualRefreshKey,
} from "./git-refresh-coordinator";

export type ManualRefresh = {
  refresh: () => Promise<void>;
  isRefreshing: boolean;
  /** The last failure of a manual Refresh in this context. A later success clears it. */
  refreshError: string | null;
};

export type GitRefresh = (mode: GitDiffRefreshMode, withFiles?: GitFileRefresh) => Promise<void>;

export type GitRefreshControl = {
  /** Refreshes the shown context. `soft` and `scheduled` reject when a read fails. */
  refresh: GitRefresh;
  manual: ManualRefresh;
};

const reportFailedCheck = (description: string): void => {
  toast.error("Could not refresh Git changes", { description });
};

/**
 * Connects a Git panel to its refresh coordinator. The view of each render goes to the
 * coordinator, and a return to the app starts a scheduled refresh.
 */
export function useGitRefresh({
  view,
  refreshOnFocus,
}: {
  view: GitRefreshView | null;
  refreshOnFocus: boolean;
}): GitRefreshControl {
  const [coordinator] = useState(
    () => new GitRefreshCoordinator({ now: Date.now, onFailedCheck: reportFailedCheck }),
  );
  useLayoutEffect(() => {
    coordinator.publish(view);
  }, [coordinator, view]);
  // Unmount ends every step that waits for a later render.
  useLayoutEffect(() => () => coordinator.publish(null), [coordinator]);
  const key = view ? manualRefreshKey(view) : "";
  const getState = useCallback(() => coordinator.manualState(key), [coordinator, key]);
  const state = useSyncExternalStore(coordinator.subscribe, getState);
  const refresh = useCallback<GitRefresh>(
    (mode, withFiles) => coordinator.refresh(mode, withFiles),
    [coordinator],
  );
  // A return to the window fires both focus and visibilitychange, so one scheduled refresh runs.
  const scheduledRun = useRef<Promise<void> | null>(null);
  const refreshWhenVisible = useEffectEvent(() => {
    if (document.visibilityState !== "visible" || scheduledRun.current) return;
    // Each view shows its own failed read.
    scheduledRun.current = coordinator
      .refresh("scheduled")
      .catch(() => undefined)
      .finally(() => {
        scheduledRun.current = null;
      });
  });
  useEffect(() => {
    if (!refreshOnFocus) return;
    globalThis.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      globalThis.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshOnFocus]);
  const manualRefresh = useCallback(() => coordinator.refresh("hard"), [coordinator]);
  const manual = useMemo<ManualRefresh>(
    () => ({ refresh: manualRefresh, isRefreshing: state.isRefreshing, refreshError: state.error }),
    [manualRefresh, state],
  );
  return useMemo(() => ({ refresh, manual }), [refresh, manual]);
}
