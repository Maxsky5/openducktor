import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildChecksStateValue } from "../app-state-context-values";
import { useActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  ChecksOperationsContext,
  type ChecksOperationsContextValue,
  ChecksStateContext,
} from "../app-state-contexts";
import { useHostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useChecks } from "../operations/workspace/use-checks";

type ChecksStateProviderProps = PropsWithChildren;

export function ChecksStateProvider({ children }: ChecksStateProviderProps): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { refresh: refreshHostRuntimeStatus } = useHostRuntimeStatusContext();
  const {
    pathCheck,
    gitCheck,
    checksRepoPath,
    taskStoreCheck,
    isRefreshingChecks,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
  } = useChecks({
    activeWorkspace,
    refreshHostRuntimeStatus,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        pathCheck,
        gitCheck,
        checksRepoPath,
        taskStoreCheck,
        isRefreshingChecks,
        refreshChecks,
      }),
    [pathCheck, checksRepoPath, isRefreshingChecks, refreshChecks, gitCheck, taskStoreCheck],
  );

  const checksOperationsValue = useMemo<ChecksOperationsContextValue>(
    () => ({ refreshTaskStoreCheckForRepo }),
    [refreshTaskStoreCheckForRepo],
  );

  return (
    <ChecksOperationsContext.Provider value={checksOperationsValue}>
      <ChecksStateContext.Provider value={checksStateValue}>{children}</ChecksStateContext.Provider>
    </ChecksOperationsContext.Provider>
  );
}
