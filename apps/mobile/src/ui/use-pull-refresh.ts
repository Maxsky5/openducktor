import { useCallback, useState } from "react";

export type PullRefresh = {
  /** True from the pull until its refresh settles. */
  pulling: boolean;
  pull: () => void;
};

/**
 * The progress of a pull to refresh for `ListRefreshControl`. The pull owns its spinner, so a read
 * that starts on its own, as after a reconnect, does not show the pull spinner, and the spinner
 * stays until the refresh that the pull started settles. `refresh` must show its own failure, such
 * as the error state of its query, because the pull only ends the spinner.
 */
export function usePullRefresh<Result>(refresh: () => Promise<Result>): PullRefresh {
  const [pulling, setPulling] = useState(false);
  const pull = useCallback(() => {
    setPulling(true);
    void refresh()
      .catch(() => {})
      .finally(() => setPulling(false));
  }, [refresh]);
  return { pulling, pull };
}
