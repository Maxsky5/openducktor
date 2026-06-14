import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type {
  AgentSessionCollection,
  AgentSessionCollectionUpdater,
} from "@/state/agent-session-collection";
import type {
  AgentSessionIdentity,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  buildRepoSessionReadModel,
  readRepoRuntimeSessionPresence,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import {
  loadTaskSessionRecordsForTask,
  loadTaskSessionRecordsForTasks,
} from "../session-read-model/task-session-records";
import { createRepoStaleGuard } from "../support/core";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import {
  loadSessionHistorySnapshot,
  type SessionHistoryLoaderAdapter,
} from "./session-history-loader";
import { loadSessionHistoryForReadModel } from "./session-history-read-model-loader";
import {
  buildHistoryRuntimeContext,
  type SessionHistoryRuntimeContext,
  withSessionHistoryRuntimeContext,
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
  listenToAgentSession?: ListenToAgentSession;
  queryClient: QueryClient;
  taskRef: MutableRefObject<TaskCard[]>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type CreateLoadAgentSessionHistoryArgs = {
  adapter: SessionHistoryLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  updateSession: UpdateSession;
  activeWorkspace: ActiveWorkspace | null;
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
  listenToAgentSession?: ListenToAgentSession;
  sessionsRef: SessionsSnapshotRef;
  historyRuntimeContext: SessionHistoryRuntimeContext;
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

  const readModel = buildRepoSessionReadModel({
    repoPath,
    tasks,
    currentSessionCollection: sessionsRef.current,
    runtimePresence,
  });
  commitSessions(readModel.sessionCollection);

  if (isStaleRepoOperation()) {
    return;
  }
  await Promise.all(
    readModel.sessionObserverRefs.map(async (session) => {
      if (!isStaleRepoOperation()) {
        await listenToAgentSession?.(session);
      }
    }),
  );

  if (isStaleRepoOperation()) {
    return;
  }

  await loadSessionHistoryForReadModel({
    repoPath,
    adapter,
    updateSession,
    sessionCollection: readModel.sessionCollection,
    sessionObserverRefs: readModel.sessionObserverRefs,
    historyRuntimeContext,
    isStaleRepoOperation,
    targetExternalSessionId: options?.targetExternalSessionId,
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
  listenToAgentSession?: ListenToAgentSession;
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
    ...(listenToAgentSession ? { listenToAgentSession } : {}),
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
  options?: AgentSessionLoadOptions,
) => Promise<void>) => {
  return async (taskId: string, options?: AgentSessionLoadOptions): Promise<void> => {
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
      persistedRecords: options?.persistedRecords,
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
      ...(listenToAgentSession ? { listenToAgentSession } : {}),
      sessionsRef,
      historyRuntimeContext,
      isStaleRepoOperation,
      ...(options ? { options } : {}),
    });
  };
};

export const createLoadAgentSessionHistory = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  updateSession,
  taskRef,
  loadRepoPromptOverrides,
}: CreateLoadAgentSessionHistoryArgs): ((input: {
  session: AgentSessionState;
}) => Promise<void>) => {
  return async ({ session }): Promise<void> => {
    const repoPath = currentWorkspaceRepoPathRef.current;
    if (!repoPath || !activeWorkspace) {
      return;
    }

    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });

    if (isStaleRepoOperation()) {
      return;
    }

    const [sessionWithRuntimeContext] = await withSessionHistoryRuntimeContext({
      sessions: [session],
      context: buildHistoryRuntimeContext({
        activeWorkspace,
        tasks: taskRef.current,
        loadRepoPromptOverrides,
      }),
    });
    if (isStaleRepoOperation()) {
      return;
    }

    const result = await loadSessionHistorySnapshot({
      repoPath,
      adapter,
      updateSession,
      session: sessionWithRuntimeContext ?? session,
      isStaleRepoOperation,
    });
    if (result.status === "failed") {
      throw result.error;
    }
  };
};
