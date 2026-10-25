import type { DelegationStateContextValue } from "../../types/state-slices";
import { createElement, type PropsWithChildren, type ReactElement, useMemo } from "react";
import {
  DelegationStateContext,
  useActiveWorkspaceContext,
  useRuntimeDefinitionsContext,
  useTaskControlContext,
} from "../app-state-contexts";
import { useDelegationOperations } from "../../tasks/operations/use-delegation-operations";

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
    (): DelegationStateContextValue => ({
      delegateTask,
    }),
    [delegateTask],
  );

  return createElement(DelegationStateContext.Provider, { value: delegationStateValue }, children);
}
