import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type {
  AgentSessionCollection,
  AgentSessionCollectionUpdater,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, LoadAgentSessionsOptions } from "@/types/state-slices";
import {
  buildRepoSessionReadModel,
  type RepoSessionReadModel,
  readRepoRuntimeSessionPresence,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import {
  loadTaskSessionRecordsForTask,
  loadTaskSessionRecordsForTasks,
} from "../session-read-model/task-session-records";
import { createRepoStaleGuard } from "../support/core";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import type { SessionHistoryLoaderAdapter } from "./session-history-loader";
import { loadSessionHistoryForReadModel } from "./session-history-read-model-loader";
import {
  buildHistoryRuntimeContext,
  type SessionHistoryRuntimeContext,
} from "./session-history-runtime-context";

type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type CommitSessions = (updater: AgentSessionCollectionUpdater) => void;
type SessionsSnapshotRef = { readonly current: AgentSessionCollection };

type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionPresence"> &
  SessionHistoryLoaderAdapter;

type CreateLoadAgentSessionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  sessionsRef: SessionsSnapshotRef;
  setSessionCollection: CommitSessions;
  updateSession: UpdateSession;
  listenToAgentSession: ListenToAgentSession;
  queryClient: QueryClient;
  taskRef: MutableRefObject<TaskCard[]>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

export const loadRepoAgentSessions = async ({
  repoPath,
  tasks,
  adapter,
  commitSessions,
  updateSession,
  listenToAgentSession,
  sessionsRef,
  historyRuntimeContext,
  isStaleRepoOperation,
  options,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  adapter: SessionLoaderAdapter;
  commitSessions: CommitSessions;
  updateSession: UpdateSession;
  listenToAgentSession: ListenToAgentSession;
  sessionsRef: SessionsSnapshotRef;
  historyRuntimeContext: SessionHistoryRuntimeContext;
  isStaleRepoOperation: () => boolean;
  options?: LoadAgentSessionsOptions;
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

  const readModelRef: { current: RepoSessionReadModel | null } = { current: null };
  commitSessions((currentSessionCollection) => {
    const nextReadModel = buildRepoSessionReadModel({
      repoPath,
      tasks,
      currentSessionCollection,
      runtimePresence,
    });
    readModelRef.current = nextReadModel;
    return nextReadModel.sessionCollection;
  });

  if (isStaleRepoOperation()) {
    return;
  }
  const readModel = readModelRef.current;
  if (!readModel) {
    return;
  }

  await Promise.all(
    readModel.liveSessionRefs.map(async (session) => {
      if (!isStaleRepoOperation()) {
        await listenToAgentSession(session);
      }
    }),
  );

  if (isStaleRepoOperation()) {
    return;
  }

  await loadSessionHistoryForReadModel({
    repoPath,
    adapter,
    sessionsRef,
    updateSession,
    sessionCollection: readModel.sessionCollection,
    liveSessionRefs: readModel.liveSessionRefs,
    historyRuntimeContext,
    isStaleRepoOperation,
    requestedSession: options?.historyTargetSession,
  });
};

export const loadRepoAgentSessionsForTasks = async ({
  activeWorkspace,
  repoPath,
  tasks,
  adapter,
  commitSessions,
  updateSession,
  listenToAgentSession,
  sessionsRef,
  queryClient,
  loadRepoPromptOverrides,
  isStaleRepoOperation,
}: {
  activeWorkspace: ActiveWorkspace;
  repoPath: string;
  tasks: TaskCard[];
  adapter: SessionLoaderAdapter;
  commitSessions: CommitSessions;
  updateSession: UpdateSession;
  listenToAgentSession: ListenToAgentSession;
  sessionsRef: SessionsSnapshotRef;
  queryClient: QueryClient;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  isStaleRepoOperation: () => boolean;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const taskSessionRecords = await loadTaskSessionRecordsForTasks({
    queryClient,
    repoPath,
    tasks,
  });
  if (isStaleRepoOperation()) {
    return;
  }

  await loadRepoAgentSessions({
    repoPath,
    tasks: taskSessionRecords,
    adapter,
    commitSessions,
    updateSession,
    listenToAgentSession,
    sessionsRef,
    historyRuntimeContext: buildHistoryRuntimeContext({
      activeWorkspace,
      tasks,
      loadRepoPromptOverrides,
    }),
    isStaleRepoOperation,
  });
};

export const createLoadAgentSessions = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  setSessionCollection,
  updateSession,
  listenToAgentSession,
  sessionsRef,
  queryClient,
  taskRef,
  loadRepoPromptOverrides,
}: CreateLoadAgentSessionsArgs): ((
  taskId: string,
  options?: LoadAgentSessionsOptions,
) => Promise<void>) => {
  return async (taskId: string, options?: LoadAgentSessionsOptions): Promise<void> => {
    if (!activeWorkspace?.repoPath || taskId.trim().length === 0) {
      return;
    }

    const workspace = activeWorkspace;
    const repoPath = activeWorkspace.repoPath;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
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
    });
    if (isStaleRepoOperation()) {
      return;
    }

    const historyRuntimeContext = buildHistoryRuntimeContext({
      activeWorkspace: workspace,
      tasks: taskRef.current,
      loadRepoPromptOverrides,
    });

    await loadRepoAgentSessions({
      repoPath,
      tasks: [task],
      adapter,
      commitSessions: setSessionCollection,
      updateSession,
      listenToAgentSession,
      sessionsRef,
      historyRuntimeContext,
      isStaleRepoOperation,
      ...(options ? { options } : {}),
    });
  };
};
