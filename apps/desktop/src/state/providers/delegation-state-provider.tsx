import type { RunEvent } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useMemo, useState } from "react";
import { buildDelegationStateValue } from "../app-state-context-values";
import {
  DelegationEventsContext,
  type DelegationEventsContextValue,
  DelegationStateContext,
  useActiveRepoContext,
  useTaskControlContext,
} from "../app-state-contexts";
import { useDelegationOperations } from "../operations";

export function DelegationStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const { refreshTaskData } = useTaskControlContext();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const { delegateTask, delegateRespond, delegateStop, delegateCleanup } = useDelegationOperations({
    activeRepo,
    refreshTaskData,
  });

  const delegationStateValue = useMemo(
    () =>
      buildDelegationStateValue({
        events,
        delegateTask,
        delegateRespond,
        delegateStop,
        delegateCleanup,
      }),
    [delegateCleanup, delegateRespond, delegateStop, delegateTask, events],
  );

  const delegationEventsValue = useMemo<DelegationEventsContextValue>(
    () => ({
      setEvents,
    }),
    [],
  );

  return (
    <DelegationEventsContext.Provider value={delegationEventsValue}>
      <DelegationStateContext.Provider value={delegationStateValue}>
        {children}
      </DelegationStateContext.Provider>
    </DelegationEventsContext.Provider>
  );
}
