import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import {
  buildRepoSessionReadModel,
  readRepoRuntimeSessionSnapshots,
} from "./repo-session-read-model";
import { loadTaskSessionRecordsForTasks } from "./task-session-records";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type CleanupLocalSessions = (sessions: readonly AgentSessionRef[]) => void;

type CreateLoadAgentSessionsArgs = {
  workspaceRepoPath: string | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  getObservedSessionKeys: () => ReadonlySet<string>;
  cleanupLocalSessions: CleanupLocalSessions;
  queryClient: QueryClient;
};

export const loadRepoAgentSessionsForTasks = async ({
  repoPath,
  tasks,
  adapter,
  commitSessionCollection,
  observeAgentSession,
  getObservedSessionKeys,
  cleanupLocalSessions,
  queryClient,
  isStaleRepoOperation,
  forceFresh,
}: {
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
  adapter: SessionLoaderAdapter;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  getObservedSessionKeys: () => ReadonlySet<string>;
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

  const readModel = commitSessionCollection((currentSessionCollection) => {
    const readModel = buildRepoSessionReadModel({
      repoPath,
      tasks: taskSessionRecords,
      currentSessionCollection,
      runtimeSnapshots,
      observedSessionKeys: getObservedSessionKeys(),
    });
    return {
      collection: readModel.sessionCollection,
      result: readModel,
    };
  });
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
  commitSessionCollection,
  observeAgentSession,
  getObservedSessionKeys,
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
      commitSessionCollection,
      observeAgentSession,
      getObservedSessionKeys,
      cleanupLocalSessions,
      queryClient,
      isStaleRepoOperation,
      forceFresh: true,
    });
  };
};
