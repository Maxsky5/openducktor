import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useEffect, useMemo } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
import {
  type AgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import { loadRepoAgentSessionsForTasks } from "../session-read-model/load-sessions";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";

type UseRepoSessionReadModelEffectsArgs = {
  workspaceRepoPath: string | null;
  taskIds: string[];
  isLoadingTasks: boolean;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  readSessionCollection: () => AgentSessionCollection;
  setSessionCollection: (sessionCollection: AgentSessionCollection) => void;
  agentEngine: Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
  observeAgentSession: ObserveAgentSession;
  cleanupLocalSessions: (sessions: readonly AgentSessionRef[]) => void;
  commitSessionReadModelLoadState: (state: AgentSessionReadModelLoadState) => void;
  queryClient: QueryClient;
};

const TASK_ID_SEPARATOR = "\u001f";

const toTaskIdSetKey = (taskIds: string[]): string =>
  [...new Set(taskIds)].toSorted().join(TASK_ID_SEPARATOR);

export const useRepoSessionReadModelEffects = ({
  workspaceRepoPath,
  taskIds,
  isLoadingTasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  readSessionCollection,
  setSessionCollection,
  agentEngine,
  observeAgentSession,
  cleanupLocalSessions,
  commitSessionReadModelLoadState,
  queryClient,
}: UseRepoSessionReadModelEffectsArgs) => {
  const taskIdsKey = toTaskIdSetKey(taskIds);
  const taskSessionTargets = useMemo(() => {
    if (!taskIdsKey) {
      return [];
    }
    return taskIdsKey.split(TASK_ID_SEPARATOR).map((id) => ({ id }));
  }, [taskIdsKey]);

  useEffect(() => {
    if (!workspaceRepoPath || isLoadingTasks) {
      return;
    }

    let cancelled = false;
    const isRepoStale = createRepoStaleGuard({
      repoPath: workspaceRepoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });

    const isStaleRepoOperation = (): boolean => cancelled || isRepoStale();

    const loadSessionReadModel = async (): Promise<void> => {
      if (isStaleRepoOperation()) {
        return;
      }
      commitSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      try {
        await loadRepoAgentSessionsForTasks({
          repoPath: workspaceRepoPath,
          tasks: taskSessionTargets,
          adapter: agentEngine,
          setSessionCollection,
          observeAgentSession,
          cleanupLocalSessions,
          queryClient,
          isStaleRepoOperation,
          readSessionCollection,
        });
        if (!isStaleRepoOperation()) {
          commitSessionReadModelLoadState(readyAgentSessionReadModelLoadState(workspaceRepoPath));
        }
      } catch (error) {
        if (!isStaleRepoOperation()) {
          commitSessionReadModelLoadState(
            failedAgentSessionReadModelLoadState(
              workspaceRepoPath,
              `Failed to load agent session read model for repo '${workspaceRepoPath}': ${errorMessage(
                error,
              )}`,
            ),
          );
        }
      }
    };

    void loadSessionReadModel();

    return () => {
      cancelled = true;
    };
  }, [
    agentEngine,
    queryClient,
    observeAgentSession,
    cleanupLocalSessions,
    setSessionCollection,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionReadModelLoadState,
    readSessionCollection,
    isLoadingTasks,
    taskSessionTargets,
    workspaceRepoPath,
  ]);
};
