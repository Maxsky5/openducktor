import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  buildRepoSessionReadModel,
  readRepoRuntimeSessionPresence,
  selectRepoSessionHistoryTargets,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import { loadTaskSessionRecordsForTask } from "../session-read-model/task-session-records";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import {
  loadSessionHistorySnapshot,
  loadSessionHistorySnapshots,
  type SessionHistoryLoaderAdapter,
} from "./session-history-loader";
import {
  buildHistoryRuntimeContext,
  type SessionHistoryRuntimeContext,
  withSessionHistoryRuntimeContext,
} from "./session-history-runtime-context";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionsById = Record<string, AgentSessionState>;

type SessionStateUpdater = SessionsById | ((current: SessionsById) => SessionsById);

type CommitSessions = (updater: SessionStateUpdater) => void;
type SessionsSnapshotRef = { readonly current: SessionsById };

type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionPresence"> &
  SessionHistoryLoaderAdapter;

type CreateLoadAgentSessionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  sessionsRef: SessionsSnapshotRef;
  setSessionsById: CommitSessions;
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
    currentSessionsById: sessionsRef.current,
    runtimePresence,
  });
  commitSessions(readModel.sessionsById);

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

  const historySessions = selectRepoSessionHistoryTargets({
    readModel,
    targetExternalSessionId: options?.targetExternalSessionId,
  });

  if (historySessions.length === 0) {
    return;
  }

  const historySessionsWithRuntimeContext = await withSessionHistoryRuntimeContext({
    sessions: historySessions,
    context: historyRuntimeContext,
  });
  if (isStaleRepoOperation()) {
    return;
  }

  await loadSessionHistorySnapshots({
    repoPath,
    adapter,
    updateSession,
    sessions: historySessionsWithRuntimeContext,
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

    const historyRuntimeContext = buildHistoryRuntimeContext({
      activeWorkspace: workspace,
      tasks: taskRef.current,
      loadRepoPromptOverrides,
    });

    await loadRepoAgentSessions({
      repoPath,
      tasks: [task],
      adapter,
      commitSessions: setSessionsById,
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
