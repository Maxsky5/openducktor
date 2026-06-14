import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import type { ActiveWorkspace } from "@/types/state-slices";
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

type CommitSessions = (updater: AgentSessionCollectionUpdater) => void;
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionPresence">;

type CreateLoadAgentSessionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  setSessionCollection: CommitSessions;
  listenToAgentSession: ListenToAgentSession;
  queryClient: QueryClient;
};

export const loadRepoAgentSessions = async ({
  repoPath,
  tasks,
  adapter,
  commitSessions,
  listenToAgentSession,
  isStaleRepoOperation,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  adapter: SessionLoaderAdapter;
  commitSessions: CommitSessions;
  listenToAgentSession: ListenToAgentSession;
  isStaleRepoOperation: () => boolean;
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
};

export const loadRepoAgentSessionsForTasks = async ({
  repoPath,
  tasks,
  adapter,
  commitSessions,
  listenToAgentSession,
  queryClient,
  isStaleRepoOperation,
}: {
  repoPath: string;
  tasks: TaskCard[];
  adapter: SessionLoaderAdapter;
  commitSessions: CommitSessions;
  listenToAgentSession: ListenToAgentSession;
  queryClient: QueryClient;
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
    listenToAgentSession,
    isStaleRepoOperation,
  });
};

export const createLoadAgentSessions = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  setSessionCollection,
  listenToAgentSession,
  queryClient,
}: CreateLoadAgentSessionsArgs): ((taskId: string) => Promise<void>) => {
  return async (taskId: string): Promise<void> => {
    if (!activeWorkspace?.repoPath || taskId.trim().length === 0) {
      return;
    }

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

    await loadRepoAgentSessions({
      repoPath,
      tasks: [task],
      adapter,
      commitSessions: setSessionCollection,
      listenToAgentSession,
      isStaleRepoOperation,
    });
  };
};
