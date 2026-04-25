import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { useWorkspaceState } from "@/state";
import { buildDelegationStateValue } from "../app-state-context-values";
import { DelegationStateContext, useTaskControlContext } from "../app-state-contexts";
import { useDelegationOperations } from "../operations";

export function DelegationStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useWorkspaceState();
  const { refreshTaskData } = useTaskControlContext();

  const { delegateTask } = useDelegationOperations({ activeWorkspace, refreshTaskData });

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
