import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import {
  buildRepoSessionReadModel,
  type RepoSessionReadModel,
  readRepoRuntimeSessionSnapshots,
} from "./repo-session-read-model";
import { loadTaskSessionRecordsForTasks } from "./task-session-records";

type SetSessionCollection = (updater: AgentSessionCollectionUpdater) => void;
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type CleanupLocalSessions = (sessions: readonly AgentSessionRef[]) => void;

type CreateLoadAgentSessionsArgs = {
  workspaceRepoPath: string | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  setSessionCollection: SetSessionCollection;
  observeAgentSession: ObserveAgentSession;
  cleanupLocalSessions: CleanupLocalSessions;
  queryClient: QueryClient;
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
  forceFresh,
}: {
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
  adapter: SessionLoaderAdapter;
  setSessionCollection: SetSessionCollection;
  observeAgentSession: ObserveAgentSession;
  cleanupLocalSessions: CleanupLocalSessions;
  queryClient: QueryClient;
  isStaleRepoOperation: () => boolean;
  forceFresh?: boolean;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const taskSessionRecords = await loadTaskSessionRecordsForTasks({
    queryClient,
    repoPath,
    tasks,
    ...(forceFresh === undefined ? {} : { forceFresh }),
  });
  if (isStaleRepoOperation()) {
    return;
  }

  const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
    repoPath,
    tasks: taskSessionRecords,
    listSessionRuntimeSnapshots: (input) => adapter.listSessionRuntimeSnapshots(input),
  });
  if (isStaleRepoOperation()) {
    return;
  }

  const committedReadModel: { current: RepoSessionReadModel | null } = { current: null };
  setSessionCollection((currentSessionCollection) => {
    const readModel = buildRepoSessionReadModel({
      repoPath,
      tasks: taskSessionRecords,
      currentSessionCollection,
      runtimeSnapshots,
    });
    committedReadModel.current = readModel;
    return readModel.sessionCollection;
  });
  const readModel = committedReadModel.current;
  if (!readModel) {
    return;
  }
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

export const createLoadAgentSessions = ({
  workspaceRepoPath,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
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

    await loadRepoAgentSessionsForTasks({
      repoPath,
      tasks: [{ id: taskId }],
      adapter,
      setSessionCollection,
      observeAgentSession,
      cleanupLocalSessions,
      queryClient,
      isStaleRepoOperation,
      forceFresh: true,
    });
  };
};
