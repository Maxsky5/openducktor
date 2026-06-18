import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import { readRepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import { buildRepoSessionReadModel } from "./repo-session-read-model";
import { deriveSessionRuntimeReadiness } from "./session-runtime-readiness";
import { loadTaskSessionRecordsForTasks } from "./task-session-records";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type ClearSessionObservationState = (sessions: readonly AgentSessionRef[]) => void;

type CreateLoadAgentSessionsArgs = {
  workspaceRepoPath: string | null;
  adapter: SessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  clearSessionObservationState: ClearSessionObservationState;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  queryClient: QueryClient;
};

export const loadRepoAgentSessionsForTasks = async ({
  repoPath,
  tasks,
  adapter,
  commitSessionCollection,
  observeAgentSession,
  clearSessionObservationState,
  runtimeHealthByRuntime,
  queryClient,
  isStaleRepoOperation,
  forceFresh,
}: {
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
  adapter: SessionLoaderAdapter;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  clearSessionObservationState: ClearSessionObservationState;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  queryClient: QueryClient;
  isStaleRepoOperation: () => boolean;
  forceFresh?: boolean;
}): Promise<boolean> => {
  if (isStaleRepoOperation()) {
    return false;
  }

  const taskSessionRecords = await loadTaskSessionRecordsForTasks({
    queryClient,
    repoPath,
    tasks,
    ...(forceFresh === undefined ? {} : { forceFresh }),
  });
  if (isStaleRepoOperation()) {
    return false;
  }

  const runtimeReadiness = deriveSessionRuntimeReadiness({
    tasks: taskSessionRecords,
    runtimeHealthByRuntime,
  });
  if (runtimeReadiness.kind === "waiting_for_runtime") {
    return false;
  }
  if (runtimeReadiness.kind === "blocked") {
    throw new Error(runtimeReadiness.message);
  }

  const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
    repoPath,
    tasks: taskSessionRecords,
    listSessionRuntimeSnapshots: (input) => adapter.listSessionRuntimeSnapshots(input),
  });
  if (isStaleRepoOperation()) {
    return false;
  }

  const readModel = commitSessionCollection((currentSessionCollection) => {
    const readModel = buildRepoSessionReadModel({
      repoPath,
      tasks: taskSessionRecords,
      currentSessionCollection,
      runtimeSnapshots,
    });
    return {
      collection: readModel.sessionCollection,
      result: readModel,
    };
  });
  clearSessionObservationState(readModel.unlistedSessionRefs);

  if (isStaleRepoOperation()) {
    return false;
  }

  await Promise.all(
    readModel.liveSessionRefs.map(async (session) => {
      if (!isStaleRepoOperation()) {
        await observeAgentSession(session);
      }
    }),
  );
  return true;
};

export const createLoadAgentSessions = ({
  workspaceRepoPath,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  commitSessionCollection,
  observeAgentSession,
  clearSessionObservationState,
  runtimeHealthByRuntime,
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
      clearSessionObservationState,
      runtimeHealthByRuntime,
      queryClient,
      isStaleRepoOperation,
      forceFresh: true,
    });
  };
};
