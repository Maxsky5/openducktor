import { useActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  AUTOPILOT_NOT_CLAIMED_DESCRIPTION,
  type AutopilotHeldOutcomeRow,
  autopilotNotClaimedTitle,
  buildAutopilotHeldOutcomeRows,
} from "@openducktor/frontend-core/autopilot/autopilot-outcome-copy";
import { retryAutopilotRecovery } from "@openducktor/frontend-core/autopilot/autopilot-recovery";
import {
  useClientConnection,
  useHostConnection,
} from "@openducktor/frontend-core/connection/client-connection-react";
import { RESULT_UNKNOWN_TITLE } from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  autopilotQueryKeys,
  autopilotStateQueryOptions,
} from "@openducktor/frontend-core/queries/autopilot";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { toAgentUserMessageParts } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { heldOutcomeRecoveriesOf } from "./held-outcome-recoveries";
import { changesHeldOutcomes } from "./held-outcomes-events";

/** One held outcome of a task as the task details show it. */
type HeldOutcomeItem = AutopilotHeldOutcomeRow & {
  /** A claim or send runs. */
  isRetrying: boolean;
  /** The note after the last retry, such as a failure cause. */
  note: { tone: "warning" | "destructive"; title: string; message: string } | null;
};

export type HeldOutcomes = {
  items: HeldOutcomeItem[];
  /** Why Autopilot cannot evaluate task changes, for all workspaces of the host. */
  failure: string | null;
  error: string | null;
  isLoading: boolean;
  retry: (outcomeId: string) => void;
  reload: () => void;
};

/**
 * The failed and skipped Autopilot outcomes that the host holds for a task, and the Autopilot
 * failure of the host. Outcome and failure run events and a reconnect after missed events read
 * them again. Retry message claims the recovery on the host
 * once, then sends the unsent first message through the session send path.
 */
export function useHeldOutcomes(workspaceId: string, taskId: string): HeldOutcomes {
  const queryClient = useQueryClient();
  const host = useHostConnection();
  const connection = useClientConnection();
  const { feedback } = connection;
  const { sendAgentMessage } = useAgentOperationsContext();
  const { activeWorkspace } = useActiveWorkspaceContext();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);
  const query = useQuery(autopilotStateQueryOptions(workspaceId));
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  const [notes, setNotes] = useState<ReadonlyMap<string, HeldOutcomeItem["note"]>>(() => new Map());
  const recoveries = heldOutcomeRecoveriesOf(connection);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let disposed = false;
    const reload = () => {
      void queryClient.invalidateQueries({ queryKey: autopilotQueryKeys.state(workspaceId) });
    };
    void host
      .subscribeRunEvents((payload) => {
        if (changesHeldOutcomes(payload, workspaceId)) reload();
      })
      .then(
        (unsubscribe) => {
          if (disposed) unsubscribe();
          else stop = unsubscribe;
        },
        (cause: unknown) => {
          if (!disposed) {
            feedback.show("error", "Autopilot updates are unavailable.", {
              description: `${errorMessage(cause)} Close the task and open it again.`,
            });
          }
        },
      );
    return () => {
      disposed = true;
      stop?.();
    };
  }, [feedback, host, queryClient, workspaceId]);

  const rows = useMemo(
    () => (query.data ? buildAutopilotHeldOutcomeRows(query.data, taskId) : []),
    [query.data, taskId],
  );

  const retry = useCallback(
    (outcomeId: string) => {
      const row = rows.find((entry) => entry.outcome.outcomeId === outcomeId);
      if (!row || row.outcome.kind !== "failed") return;
      const recovery = recoveries.recoveryOf(row.outcome);
      if (!recovery) return;
      setRetrying((current) => new Set(current).add(outcomeId));
      void retryAutopilotRecovery(recovery, {
        claimRecovery: (input) => host.client.autopilotRecoveryClaim(input),
        sendMessage: (session, instruction) =>
          sendAgentMessage(session, toAgentUserMessageParts(instruction), {
            preserveTextWhitespace: true,
          }),
        isWorkspaceSelected: (id) => activeWorkspaceIdRef.current === id,
      })
        .then((result) => {
          let note: HeldOutcomeItem["note"] = null;
          if (result === "sent") feedback.show("success", "Message sent");
          if (result === "unknown") {
            note = { tone: "warning", title: RESULT_UNKNOWN_TITLE, message: recovery.message };
          }
          if (result === "not_claimed") {
            note = {
              tone: "warning",
              title: autopilotNotClaimedTitle(row.outcome),
              message: AUTOPILOT_NOT_CLAIMED_DESCRIPTION,
            };
          }
          if (result === "failed" || result === "workspace_not_selected") {
            note = { tone: "destructive", title: "Retry failed", message: recovery.message };
          }
          setNotes((current) => new Map(current).set(outcomeId, note));
        })
        .finally(() => {
          setRetrying((current) => {
            const next = new Set(current);
            next.delete(outcomeId);
            return next;
          });
        });
    },
    [feedback, host, recoveries, rows, sendAgentMessage],
  );

  const items = useMemo<HeldOutcomeItem[]>(
    () =>
      rows.map((row) => {
        const recovery = row.outcome.kind === "failed" ? recoveries.recoveryOf(row.outcome) : null;
        return {
          ...row,
          canRetry: row.canRetry && recovery !== null && !recovery.done,
          isRetrying: retrying.has(row.outcome.outcomeId),
          note: notes.get(row.outcome.outcomeId) ?? null,
        };
      }),
    [notes, recoveries, retrying, rows],
  );
  const { refetch } = query;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    items,
    failure: query.data?.failure ?? null,
    error: query.error ? errorMessage(query.error) : null,
    isLoading: query.isPending,
    retry,
    reload,
  };
}
