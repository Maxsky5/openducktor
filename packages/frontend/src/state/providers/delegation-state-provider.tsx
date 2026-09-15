import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildDelegationStateValue } from "../app-state-context-values";
import {
  DelegationStateContext,
  useActiveWorkspaceContext,
  useRuntimeDefinitionsContext,
  useTaskControlContext,
} from "../app-state-contexts";
import { useDelegationOperations } from "../operations/tasks/use-delegation-operations";

export function DelegationStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { refreshTaskData } = useTaskControlContext();
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();

  const { delegateTask } = useDelegationOperations({
    activeWorkspace,
    refreshTaskData,
    loadRepoRuntimeCatalog,
  });

  const delegationStateValue = useMemo(
    () =>
      buildDelegationStateValue({
        delegateTask,
      }),
    [delegateTask],
  );

  return (
    <DelegationStateContext.Provider value={delegationStateValue}>
      {children}
    </DelegationStateContext.Provider>
  );
}
