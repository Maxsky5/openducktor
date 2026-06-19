import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import {
  type AgentSessionReadModelLoadState,
  currentAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { loadRepoAgentSessionsForTasks } from "../session-read-model/load-sessions";
import { sessionRuntimeReadinessKey } from "../session-read-model/session-runtime-readiness";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";

type UseRepoSessionReadModelArgs = {
  workspaceRepoPath: string | null;
  taskIds: string[];
  isLoadingTasks: boolean;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  commitSessionCollection: AgentSessionsStore["commitSessionCollection"];
  agentEngine: Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
  observeAgentSession: ObserveAgentSession;
  clearSessionObservationState: (sessions: readonly AgentSessionRef[]) => void;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  queryClient: QueryClient;
};

const TASK_ID_SEPARATOR = "\u001f";

const toTaskIdSetKey = (taskIds: string[]): string =>
  [...new Set(taskIds)].toSorted().join(TASK_ID_SEPARATOR);

export const useRepoSessionReadModel = ({
  workspaceRepoPath,
  taskIds,
  isLoadingTasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  commitSessionCollection,
  agentEngine,
  observeAgentSession,
  clearSessionObservationState,
  runtimeHealthByRuntime,
  queryClient,
}: UseRepoSessionReadModelArgs): AgentSessionReadModelLoadState => {
  const [sessionReadModelLoadState, setSessionReadModelLoadState] =
    useState<AgentSessionReadModelLoadState>(unavailableAgentSessionReadModelLoadState);
  const currentSessionReadModelLoadState = useMemo(
    () =>
      currentAgentSessionReadModelLoadState({
        workspaceRepoPath,
        state: sessionReadModelLoadState,
      }),
    [sessionReadModelLoadState, workspaceRepoPath],
  );
  const taskIdsKey = toTaskIdSetKey(taskIds);
  const taskSessionTargets = useMemo(() => {
    if (!taskIdsKey) {
      return [];
    }
    return taskIdsKey.split(TASK_ID_SEPARATOR).map((id) => ({ id }));
  }, [taskIdsKey]);
  const runtimeReadinessKey = sessionRuntimeReadinessKey(runtimeHealthByRuntime);
  const runtimeHealthByRuntimeRef = useRef(runtimeHealthByRuntime);
  runtimeHealthByRuntimeRef.current = runtimeHealthByRuntime;

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
      const runtimeHealthSnapshot = runtimeHealthByRuntimeRef.current;
      if (sessionRuntimeReadinessKey(runtimeHealthSnapshot) !== runtimeReadinessKey) {
        return;
      }
      setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      try {
        const didLoadSessionReadModel = await loadRepoAgentSessionsForTasks({
          repoPath: workspaceRepoPath,
          tasks: taskSessionTargets,
          adapter: agentEngine,
          commitSessionCollection,
          observeAgentSession,
          clearSessionObservationState,
          runtimeHealthByRuntime: runtimeHealthSnapshot,
          queryClient,
          isStaleRepoOperation,
        });
        if (!isStaleRepoOperation() && didLoadSessionReadModel) {
          setSessionReadModelLoadState(readyAgentSessionReadModelLoadState(workspaceRepoPath));
        }
      } catch (error) {
        if (!isStaleRepoOperation()) {
          setSessionReadModelLoadState(
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
    clearSessionObservationState,
    commitSessionCollection,
    runtimeReadinessKey,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    isLoadingTasks,
    taskSessionTargets,
    workspaceRepoPath,
  ]);

  return currentSessionReadModelLoadState;
};
