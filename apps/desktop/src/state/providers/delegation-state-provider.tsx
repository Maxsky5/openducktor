import type { RunEvent } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useCallback, useMemo, useState } from "react";
import { useWorkspaceState } from "@/state";
import { buildDelegationStateValue } from "../app-state-context-values";
import {
  DelegationEventsContext,
  type DelegationEventsContextValue,
  DelegationStateContext,
  type RunCompletionSignal,
  useTaskControlContext,
} from "../app-state-contexts";
import { useDelegationOperations } from "../operations";

export function DelegationStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useWorkspaceState();
  const { refreshTaskData } = useTaskControlContext();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runCompletionSignal, setRunCompletionSignalState] = useState<RunCompletionSignal | null>(
    null,
  );
  const setRunCompletionSignal = useCallback((runId: string, eventType: RunEvent["type"]) => {
    setRunCompletionSignalState((previousRunCompletionSignal) => ({
      runId,
      eventType,
      version: (previousRunCompletionSignal?.version ?? 0) + 1,
    }));
  }, []);

  const { delegateTask, delegateRespond, delegateStop, delegateCleanup } = useDelegationOperations({
    activeWorkspace,
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
      runCompletionSignal,
      setRunCompletionSignal,
    }),
    [runCompletionSignal, setRunCompletionSignal],
  );

  return (
    <DelegationEventsContext.Provider value={delegationEventsValue}>
      <DelegationStateContext.Provider value={delegationStateValue}>
        {children}
      </DelegationStateContext.Provider>
    </DelegationEventsContext.Provider>
  );
}
