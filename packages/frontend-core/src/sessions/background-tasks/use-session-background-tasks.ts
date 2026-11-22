import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useHostClient } from "../../connection/client-connection-react";
import { isAgentSessionLiveStateObserved } from "../../lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { errorMessage } from "../../lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "../../types/agent-orchestrator";
import { toRuntimeSessionRef } from "../agent-orchestrator/support/session-runtime-ref";
import { useAgentSessionReadModelStateContext, useAgentSessionsContext } from "../session-contexts";
import {
  type BackgroundTaskRow,
  type BackgroundTaskStopRequest,
  buildBackgroundTaskRows,
} from "./background-task-bar";

export type SessionBackgroundTasksModel = {
  readonly rows: ReadonlyArray<BackgroundTaskRow>;
  /**
   * Sends Stop for one task. Ask the user to confirm first. A task that no longer runs, such as
   * one that ended while the user confirmed, sends nothing. A confirmation that ends while the
   * live state or the status of the session is unknown also sends nothing.
   */
  readonly onStop: (taskId: string) => void;
};

type StopRequests = {
  readonly sessionKey: string;
  readonly requests: ReadonlyMap<string, BackgroundTaskStopRequest>;
  /** The tasks that the requests were last checked against. */
  readonly tasks: AgentSessionState["backgroundTasks"];
};

/** Drops the requests of the tasks that ended. No request left means no state. */
const withoutEndedRequests = (
  current: StopRequests,
  tasks: AgentSessionState["backgroundTasks"],
): StopRequests | null => {
  const running = new Set(tasks?.map((task) => task.taskId));
  const requests = new Map([...current.requests].filter(([taskId]) => running.has(taskId)));
  return requests.size === 0 ? null : { ...current, requests, tasks };
};

/**
 * The running background tasks of a session, for the bar above the composer. It is null when no
 * task runs. A row stays Stopping until the live snapshot drops its task or the stop fails, so a
 * task that ends by itself shows no error.
 */
export const useBackgroundTaskStops = ({
  repoPath,
  identity,
  tasks,
}: {
  repoPath: string | null;
  identity: AgentSessionIdentity | null;
  tasks: AgentSessionState["backgroundTasks"];
}): SessionBackgroundTasksModel | null => {
  const host = useHostClient();
  const [state, setState] = useState<StopRequests | null>(null);
  // A task can run again under the same ID, so its row must not keep the old request. Without a
  // request there is no state, so a task change renders only once.
  if (state !== null && state.tasks !== tasks) setState(withoutEndedRequests(state, tasks));
  const sessionKey = identity ? agentSessionIdentityKey(identity) : null;
  const requests = state?.sessionKey === sessionKey ? state.requests : null;
  // A confirmation can end after its task ended, so a stop checks the tasks that run now.
  const runningTasksRef = useRef(tasks);
  useLayoutEffect(() => {
    runningTasksRef.current = tasks;
  }, [tasks]);

  const onStop = useCallback(
    (taskId: string) => {
      if (!identity || !repoPath) return;
      if (!runningTasksRef.current?.some((task) => task.taskId === taskId)) return;
      const key = agentSessionIdentityKey(identity);
      // Each request has its own object, so a late answer changes only its own row.
      const stopping: BackgroundTaskStopRequest = { kind: "stopping" };
      setState((current) => ({
        sessionKey: key,
        requests: new Map([
          ...(current?.sessionKey === key ? current.requests : []),
          [taskId, stopping],
        ]),
        tasks: runningTasksRef.current,
      }));
      void (async () => {
        try {
          await host.agentSessionBackgroundTaskStop({
            ...toRuntimeSessionRef(repoPath, identity),
            taskId,
          });
        } catch (cause) {
          const failed: BackgroundTaskStopRequest = {
            kind: "failed",
            reason: errorMessage(cause),
          };
          setState((current) =>
            current?.sessionKey === key && current.requests.get(taskId) === stopping
              ? { ...current, requests: new Map([...current.requests, [taskId, failed]]) }
              : current,
          );
        }
      })();
    },
    [host, identity, repoPath],
  );

  return useMemo(
    () =>
      tasks && tasks.length > 0
        ? { rows: buildBackgroundTaskRows(tasks, requests ?? new Map()), onStop }
        : null,
    [onStop, requests, tasks],
  );
};

/**
 * The background tasks of a session while its live state is known. They are undefined while the
 * live state is unknown or the status of the session is unavailable, so the bar hides, a pending
 * confirmation sends nothing, and the rows come back when the live state is known again.
 */
const useObservedBackgroundTasks = (
  identity: AgentSessionIdentity | null,
): AgentSessionState["backgroundTasks"] => {
  const sessionStore = useAgentSessionsContext();
  const { sessionReadModelLoadState } = useAgentSessionReadModelStateContext();
  const read = () => {
    const session = sessionStore.getSessionSnapshot(identity);
    return session &&
      !session.statusUnavailableReason &&
      isAgentSessionLiveStateObserved(sessionReadModelLoadState, session)
      ? session.backgroundTasks
      : undefined;
  };
  return useSyncExternalStore(sessionStore.subscribe, read, read);
};

/** The background task bar model of the session of a composer. */
export const useSessionBackgroundTasks = ({
  repoPath,
  identity,
}: {
  repoPath: string | null;
  identity: AgentSessionIdentity | null;
}): SessionBackgroundTasksModel | null =>
  useBackgroundTaskStops({ repoPath, identity, tasks: useObservedBackgroundTasks(identity) });
