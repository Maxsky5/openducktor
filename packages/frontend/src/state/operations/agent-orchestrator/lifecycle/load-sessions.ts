import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type RepoRuntimeSessionPresenceRead,
  readRepoRuntimeSessionPresence,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import {
  loadSessionHistorySnapshot,
  loadSessionHistorySnapshots,
  type SessionHistoryLoaderAdapter,
} from "./session-history-loader";
import { buildRepoSessionLoadPlan, type RepoSessionLoadPlan } from "./session-load-plan";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionsById = Record<string, AgentSessionState>;

type SessionStateUpdater = SessionsById | ((current: SessionsById) => SessionsById);

type CommitSessions = (updater: SessionStateUpdater) => void;

type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionPresence" | "restoreSession"> &
  SessionHistoryLoaderAdapter;

const commitRepoSessionLoadPlan = ({
  repoPath,
  tasks,
  runtimePresence,
  options,
  commitSessions,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  runtimePresence: RepoRuntimeSessionPresenceRead;
  options?: AgentSessionLoadOptions;
  commitSessions: CommitSessions;
}): RepoSessionLoadPlan => {
  let committedPlan: RepoSessionLoadPlan | undefined;
  commitSessions((currentSessionsById) => {
    const nextPlan = buildRepoSessionLoadPlan({
      repoPath,
      tasks,
      currentSessionsById,
      runtimePresence,
      ...(options ? { options } : {}),
    });
    committedPlan = nextPlan;
    return nextPlan.sessionsById;
  });
  if (committedPlan === undefined) {
    throw new Error("Failed to commit repo session read model.");
  }
  return committedPlan;
};

type CreateLoadAgentSessionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  setSessionsById: CommitSessions;
  updateSession: UpdateSession;
  listenToAgentSession?: ListenToAgentSession;
  queryClient: QueryClient;
};

type CreateLoadSelectedSessionHistoryArgs = {
  adapter: SessionHistoryLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  updateSession: UpdateSession;
};

const taskFromSessionRecords = (
  taskId: string,
  agentSessions: AgentSessionRecord[],
): TaskSessionRecords => ({
  id: taskId,
  agentSessions,
});

const isRepoOperationStale = ({
  repoPath,
  repoEpochAtStart,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
}: {
  repoPath: string;
  repoEpochAtStart: number;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
}): boolean => {
  return (
    repoEpochRef.current !== repoEpochAtStart || currentWorkspaceRepoPathRef.current !== repoPath
  );
};

export const loadRepoAgentSessions = async ({
  repoPath,
  tasks,
  adapter,
  commitSessions,
  updateSession,
  listenToAgentSession,
  isStaleRepoOperation,
  options,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  adapter: SessionLoaderAdapter;
  commitSessions: CommitSessions;
  updateSession: UpdateSession;
  listenToAgentSession?: ListenToAgentSession;
  isStaleRepoOperation: () => boolean;
  options?: AgentSessionLoadOptions;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const runtimePresence = await readRepoRuntimeSessionPresence({
    repoPath,
    tasks,
    listSessionPresence: (input) => adapter.listSessionPresence(input),
  });
  if (isStaleRepoOperation()) {
    return;
  }

  const committedPlan = commitRepoSessionLoadPlan({
    repoPath,
    tasks,
    runtimePresence,
    ...(options ? { options } : {}),
    commitSessions,
  });

  if (isStaleRepoOperation()) {
    return;
  }
  await Promise.all(
    committedPlan.liveSessions.map(async (session) => {
      await adapter.restoreSession(session);
      if (!isStaleRepoOperation()) {
        listenToAgentSession?.(session);
      }
    }),
  );

  if (isStaleRepoOperation()) {
    return;
  }

  if (committedPlan.historySessions.length === 0) {
    return;
  }

  await loadSessionHistorySnapshots({
    repoPath,
    adapter,
    updateSession,
    sessions: committedPlan.historySessions,
    isStaleRepoOperation,
  });
};

export const createLoadAgentSessions = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  setSessionsById,
  updateSession,
  listenToAgentSession,
  queryClient,
}: CreateLoadAgentSessionsArgs): ((
  taskId: string,
  options?: AgentSessionLoadOptions,
) => Promise<void>) => {
  return async (taskId: string, options?: AgentSessionLoadOptions): Promise<void> => {
    if (!activeWorkspace?.repoPath || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeWorkspace.repoPath;
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean =>
      isRepoOperationStale({
        repoPath,
        repoEpochAtStart,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
      });

    if (isStaleRepoOperation()) {
      return;
    }

    const records =
      options?.persistedRecords ??
      (await loadAgentSessionListFromQuery(queryClient, repoPath, taskId));
    if (isStaleRepoOperation()) {
      return;
    }

    const task = taskFromSessionRecords(taskId, records);
    await loadRepoAgentSessions({
      repoPath,
      tasks: [task],
      adapter,
      commitSessions: setSessionsById,
      updateSession,
      ...(listenToAgentSession ? { listenToAgentSession } : {}),
      isStaleRepoOperation,
      ...(options ? { options } : {}),
    });
  };
};

export const createLoadSelectedSessionHistory = ({
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  updateSession,
}: CreateLoadSelectedSessionHistoryArgs): ((input: {
  session: AgentSessionState;
}) => Promise<void>) => {
  return async ({ session }): Promise<void> => {
    if (currentWorkspaceRepoPathRef.current !== session.repoPath) {
      return;
    }

    const repoPath = session.repoPath;
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean =>
      isRepoOperationStale({
        repoPath,
        repoEpochAtStart,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
      });

    if (isStaleRepoOperation()) {
      return;
    }

    const result = await loadSessionHistorySnapshot({
      repoPath,
      adapter,
      updateSession,
      session,
      isStaleRepoOperation,
    });
    if (result.status === "failed") {
      throw result.error;
    }
  };
};
