import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import {
  buildRepoSessionReadModel,
  readRepoRuntimeSessionSnapshots,
  type TaskSessionRecords,
} from "./repo-session-read-model";
import {
  loadTaskSessionRecordsForTask,
  loadTaskSessionRecordsForTasks,
} from "./task-session-records";

type SetSessionCollection = (sessionCollection: AgentSessionCollection) => void;
type ReadSessionCollection = () => AgentSessionCollection;
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type CleanupLocalSessions = (sessions: readonly AgentSessionRef[]) => void;

type CreateLoadAgentSessionsArgs = {
  workspaceRepoPath: string | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  readSessionCollection: ReadSessionCollection;
  setSessionCollection: SetSessionCollection;
  observeAgentSession: ObserveAgentSession;
  cleanupLocalSessions: CleanupLocalSessions;
  queryClient: QueryClient;
};

export const loadRepoAgentSessions = async ({
  repoPath,
  tasks,
  adapter,
  setSessionCollection,
  observeAgentSession,
  cleanupLocalSessions,
  isStaleRepoOperation,
  readSessionCollection,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  adapter: SessionLoaderAdapter;
  setSessionCollection: SetSessionCollection;
  observeAgentSession: ObserveAgentSession;
  cleanupLocalSessions: CleanupLocalSessions;
  isStaleRepoOperation: () => boolean;
  readSessionCollection: ReadSessionCollection;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
    repoPath,
    tasks,
    listSessionRuntimeSnapshots: (input) => adapter.listSessionRuntimeSnapshots(input),
  });
  if (isStaleRepoOperation()) {
    return;
  }

  const readModel = buildRepoSessionReadModel({
    repoPath,
    tasks,
    currentSessionCollection: readSessionCollection(),
    runtimeSnapshots,
  });
  setSessionCollection(readModel.sessionCollection);
  cleanupLocalSessions(readModel.removedSessionRefs);

  if (isStaleRepoOperation()) {
    return;
  }

  await Promise.all(
    readModel.liveSessionRefs.map(async (session) => {
      if (!isStaleRepoOperation()) {
        await observeAgentSession(session);
      }
    }),
  );
};

export const loadRepoAgentSessionsForTasks = async ({
  repoPath,
  tasks,
  adapter,
  setSessionCollection,
  observeAgentSession,
  cleanupLocalSessions,
  queryClient,
  isStaleRepoOperation,
  readSessionCollection,
}: {
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
  adapter: SessionLoaderAdapter;
  setSessionCollection: SetSessionCollection;
  observeAgentSession: ObserveAgentSession;
  cleanupLocalSessions: CleanupLocalSessions;
  queryClient: QueryClient;
  isStaleRepoOperation: () => boolean;
  readSessionCollection: ReadSessionCollection;
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
    setSessionCollection,
    observeAgentSession,
    cleanupLocalSessions,
    isStaleRepoOperation,
    readSessionCollection,
  });
};

export const createLoadAgentSessions = ({
  workspaceRepoPath,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  readSessionCollection,
  setSessionCollection,
  observeAgentSession,
  cleanupLocalSessions,
  queryClient,
}: CreateLoadAgentSessionsArgs): ((taskId: string) => Promise<void>) => {
  return async (taskId: string): Promise<void> => {
    if (!workspaceRepoPath || taskId.trim().length === 0) {
      return;
    }

    const repoPath = workspaceRepoPath;
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
      forceFresh: true,
    });
    if (isStaleRepoOperation()) {
      return;
    }

    await loadRepoAgentSessions({
      repoPath,
      tasks: [task],
      adapter,
      setSessionCollection,
      observeAgentSession,
      cleanupLocalSessions,
      isStaleRepoOperation,
      readSessionCollection,
    });
  };
};
