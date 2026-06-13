import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  buildRepoSessionReadModel,
  type RepoRuntimeSessionPresenceRead,
  type RepoSessionReadModel,
  readRepoRuntimeSessionPresence,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import { loadTaskSessionRecordsForTask } from "../session-read-model/task-session-records";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import {
  loadSessionHistorySnapshot,
  loadSessionHistorySnapshots,
  type SessionHistoryLoaderAdapter,
  selectSessionHistoryTargets,
} from "./session-history-loader";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionsById = Record<string, AgentSessionState>;

type SessionStateUpdater = SessionsById | ((current: SessionsById) => SessionsById);

type CommitSessions = (updater: SessionStateUpdater) => void;

type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionPresence"> &
  SessionHistoryLoaderAdapter;

const commitRepoSessionReadModel = ({
  repoPath,
  tasks,
  runtimePresence,
  commitSessions,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  runtimePresence: RepoRuntimeSessionPresenceRead;
  commitSessions: CommitSessions;
}): RepoSessionReadModel => {
  let committedReadModel: RepoSessionReadModel | undefined;
  commitSessions((currentSessionsById) => {
    const readModel = buildRepoSessionReadModel({
      repoPath,
      tasks,
      currentSessionsById,
      runtimePresence,
    });
    committedReadModel = readModel;
    return readModel.sessionsById;
  });
  if (committedReadModel === undefined) {
    throw new Error("Failed to commit repo session read model.");
  }
  return committedReadModel;
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

  const readModel = commitRepoSessionReadModel({
    repoPath,
    tasks,
    runtimePresence,
    commitSessions,
  });

  if (isStaleRepoOperation()) {
    return;
  }
  await Promise.all(
    readModel.liveSessions.map(async (session) => {
      if (!isStaleRepoOperation()) {
        await listenToAgentSession?.(session);
      }
    }),
  );

  if (isStaleRepoOperation()) {
    return;
  }

  const historySessions = selectSessionHistoryTargets({
    sessionsById: readModel.sessionsById,
    liveSessions: readModel.liveSessions,
    ...(options ? { options } : {}),
  });

  if (historySessions.length === 0) {
    return;
  }

  await loadSessionHistorySnapshots({
    repoPath,
    adapter,
    updateSession,
    sessions: historySessions,
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

    const task = await loadTaskSessionRecordsForTask({
      queryClient,
      repoPath,
      taskId,
      persistedRecords: options?.persistedRecords,
    });
    if (isStaleRepoOperation()) {
      return;
    }

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
    const repoPath = currentWorkspaceRepoPathRef.current;
    if (!repoPath) {
      return;
    }

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
