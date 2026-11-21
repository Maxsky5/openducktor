import type {
  WorkspaceProcessGroup,
  WorkspaceProcessRow,
  WorkspaceProcessStopRequest,
} from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  readProcessActionState,
  stopWorkspaceProcesses,
  subscribeProcessActionState,
  type WorkspaceProcessStopOutcomes,
} from "@openducktor/frontend-core/queries/workspace-processes";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";

/** Reports the first process that did not stop. A stopped process folds away, which shows it. */
const reportOutcomes = (label: string, outcomes: WorkspaceProcessStopOutcomes): void => {
  const failed = outcomes.flatMap(({ outcome }) => (outcome.kind === "removed" ? [] : [outcome]));
  const [first] = failed;
  if (!first) return;
  const count = failed.length > 1 ? ` (${failed.length} processes)` : "";
  switch (first.kind) {
    case "stale":
      toast.warning(`${first.result.issue.message}${count}`, {
        description: first.result.issue.nextAction,
      });
      return;
    case "unchanged":
      toast.error(`Could not stop ${label}${count}`, { description: first.result.issue.message });
      return;
    case "lost":
      toast.error(`OpenDucktor lost the reply to the stop request for ${label}`, {
        description: errorMessage(first.error),
      });
      return;
  }
};

const stopRequest = (
  group: WorkspaceProcessGroup,
  rows: readonly WorkspaceProcessRow[],
): WorkspaceProcessStopRequest => {
  const request: WorkspaceProcessStopRequest = {
    workspaceId: group.workspaceId,
    checkoutPath: group.checkoutPath,
    processRefs: rows.map((row) => row.processRef),
  };
  // The confirmation showed the PID reuse warning for these processes.
  if (rows.some((row) => row.stop.allowed && row.stop.requiresPidReuseAcknowledgment))
    request.acknowledgedPidReuseRisk = true;
  return request;
};

/**
 * The stop requests of the Processes dialog. The connection keeps the pending stops and the
 * out-of-date rows, so a new dialog shows them too.
 */
export function useProcessStops() {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => subscribeProcessActionState(queryClient, listener),
    [queryClient],
  );
  const actionState = useSyncExternalStore(subscribe, () => readProcessActionState(queryClient));
  const { outdated } = actionState;

  /** Stops the processes that may stop, together, such as a command and its children. */
  const stop = useCallback(
    async (group: WorkspaceProcessGroup, rows: readonly WorkspaceProcessRow[], label: string) => {
      const stoppable = rows.filter((row) => row.stop.allowed);
      if (stoppable.length === 0) return;
      const outcomes = await stopWorkspaceProcesses(queryClient, stopRequest(group, stoppable));
      reportOutcomes(label, outcomes);
    },
    [queryClient],
  );

  const isOutdated = useCallback(
    (row: WorkspaceProcessRow) => outdated.has(row.processRef),
    [outdated],
  );

  return { stoppingRefs: actionState.pending, isOutdated, stop };
}
