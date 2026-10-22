import type {
  AgentSessionControlSummary,
  AgentSessionForkPoint,
  AgentSessionRecord,
  AgentWorkflowSessionForkInput,
  AgentWorkflowSessionForkResult,
  WorkspaceSessionForkInput,
  WorkspaceSessionForkResult,
} from "@openducktor/contracts";
import { type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { connectionHost } from "../connection/client-connection";
import { agentSessionIdentityKey } from "../lib/agent-session-identity";
import { agentSessionQueryKeys, updateAgentSessionListQuery } from "../queries/agent-sessions";
import { invalidateRepoBranchesQuery } from "../queries/git";
import { invalidateTerminalList } from "../queries/terminals";
import { updateWorkspaceSessionQueries } from "../queries/workspace-sessions";
import type { AgentSessionIdentity } from "../types/agent-orchestrator";
import type { AgentSessionsStore } from "./agent-sessions-store";
import { applyWorkflowSessionRecords } from "./agent-orchestrator/session-read-model/agent-session-workflow-records";
import { applyWorkspaceSessionRecords } from "./agent-orchestrator/session-read-model/workspace-session-records";

const requestsByClient = new WeakMap<QueryClient, ReturnType<typeof createForkRequests>>();

export const forkTaskSession = (
  queryClient: QueryClient,
  store: AgentSessionsStore,
  input: AgentWorkflowSessionForkInput,
): Promise<AgentWorkflowSessionForkResult> =>
  getForkRequests(queryClient).run(
    sessionForkRequestKey(input.repoPath, input, input.forkPoint),
    async () => {
      const result = await connectionHost(queryClient).agentSessionWorkflowFork(input);
      const taskId = input.sessionScope.taskId;
      const records = queryClient.getQueryData<AgentSessionRecord[]>(
        agentSessionQueryKeys.list(input.repoPath, taskId),
      );
      // An individual result cannot establish a complete task list that has never loaded.
      if (records)
        updateAgentSessionListQuery(queryClient, input.repoPath, {
          taskId,
          agentSessions: [
            ...records.filter(
              (record) =>
                agentSessionIdentityKey(record) !== agentSessionIdentityKey(result.record),
            ),
            result.record,
          ],
        });
      const workspaceStore = store.getWorkspaceStore(input.repoPath);
      workspaceStore?.setSessionCollection((projected) =>
        applyWorkflowSessionRecords({
          projected,
          associationEvidence: projected,
          records: { loadedTaskIds: new Set(), records: [{ taskId, record: result.record }] },
        }),
      );
      if (workspaceStore) applyForkSummary(workspaceStore, result.runtimeSession);
      return result;
    },
  );

export const forkWorkspaceSession = (
  queryClient: QueryClient,
  store: AgentSessionsStore,
  repoPath: string,
  source: AgentSessionIdentity,
  input: WorkspaceSessionForkInput,
): Promise<WorkspaceSessionForkResult> =>
  getForkRequests(queryClient).run(
    sessionForkRequestKey(repoPath, source, input.forkPoint),
    async () => {
      const result = await connectionHost(queryClient).workspaceSessionFork(input);
      updateWorkspaceSessionQueries(queryClient, input.workspaceId, result.record);
      const workspaceStore = store.getWorkspaceStore(repoPath);
      workspaceStore?.setSessionCollection((projected) =>
        applyWorkspaceSessionRecords(projected, [result.record]),
      );
      if (workspaceStore) applyForkSummary(workspaceStore, result.runtimeSession);
      if (input.destination.kind === "new_worktree")
        void invalidateRepoBranchesQuery(queryClient, repoPath);
      void invalidateTerminalList(queryClient, {
        kind: "workspace_session",
        workspaceId: input.workspaceId,
        sessionId: result.record.id,
      });
      return result;
    },
  );

export const sessionForkRequestKey = (
  repoPath: string,
  source: AgentSessionIdentity,
  point: AgentSessionForkPoint,
): string => JSON.stringify([repoPath, agentSessionIdentityKey(source), point.messageId]);

export const useSessionForkRequests = (queryClient: QueryClient): ReadonlySet<string> => {
  const requests = getForkRequests(queryClient);
  return useSyncExternalStore(requests.subscribe, requests.getSnapshot, requests.getSnapshot);
};

const applyForkSummary = (store: AgentSessionsStore, summary: AgentSessionControlSummary): void => {
  store.updateSession(summary, (session) =>
    session.livePresence === "present"
      ? session
      : {
          ...session,
          status: summary.status,
          startedAt: summary.startedAt,
          selectedModel: summary.model ?? session.selectedModel,
        },
  );
};

const createForkRequests = () => {
  const pending = new Map<string, Promise<unknown>>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlySet<string> = new Set();
  const publish = () => {
    snapshot = new Set(pending.keys());
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    run: <T>(key: string, perform: () => Promise<T>): Promise<T> => {
      const existing = pending.get(key);
      if (existing) {
        // SAFETY: Each key identifies one reply and operation, so its callers share a result type.
        return existing as Promise<T>;
      }
      const request = Promise.resolve()
        .then(perform)
        .finally(() => {
          pending.delete(key);
          publish();
        });
      pending.set(key, request);
      publish();
      return request;
    },
  };
};

const getForkRequests = (queryClient: QueryClient) => {
  let requests = requestsByClient.get(queryClient);
  if (!requests) {
    requests = createForkRequests();
    requestsByClient.set(queryClient, requests);
  }
  return requests;
};
