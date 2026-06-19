import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import {
  inactiveRepoRuntimeReadinessTarget,
  repoRuntimeReadinessTargetForRuntimeSet,
} from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import {
  type AgentSessionReadModelLoadState,
  currentAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import { loadRepoSessionReadModel } from "../session-read-model/repo-session-read-model-loader";
import { useTaskSessionRecords } from "../session-read-model/use-task-session-records";
import { createRepoStaleGuard } from "../support/core";
import { toPersistedSessionIdentity } from "../support/persistence";
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
  queryClient: QueryClient;
};

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
  const taskSessionRecordsState = useTaskSessionRecords({
    repoPath: workspaceRepoPath,
    taskIds,
    enabled: !isLoadingTasks,
    queryClient,
  });
  const requiredRuntimeKinds = useMemo(() => {
    if (taskSessionRecordsState.kind !== "ready") {
      return [];
    }

    return Array.from(
      new Set(
        taskSessionRecordsState.records.records.map(
          ({ record }) => toPersistedSessionIdentity(record).runtimeKind,
        ),
      ),
    ).sort();
  }, [taskSessionRecordsState]);
  const runtimeTarget = useMemo(
    () =>
      taskSessionRecordsState.kind === "ready"
        ? repoRuntimeReadinessTargetForRuntimeSet(requiredRuntimeKinds)
        : inactiveRepoRuntimeReadinessTarget,
    [requiredRuntimeKinds, taskSessionRecordsState.kind],
  );
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeTarget,
  });
  const runtimeReadinessState = runtimeReadiness.state;
  const runtimeReadinessMessage = runtimeReadiness.message ?? "";

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
      if (taskSessionRecordsState.kind === "loading") {
        setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
        return;
      }
      if (taskSessionRecordsState.kind === "failed") {
        setSessionReadModelLoadState(
          failedAgentSessionReadModelLoadState(
            workspaceRepoPath,
            `Failed to load task session records for repo '${workspaceRepoPath}': ${errorMessage(
              taskSessionRecordsState.error,
            )}`,
          ),
        );
        return;
      }
      if (runtimeReadinessState === "checking") {
        setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
        return;
      }
      if (runtimeReadinessState === "blocked") {
        setSessionReadModelLoadState(
          failedAgentSessionReadModelLoadState(
            workspaceRepoPath,
            `Failed to load agent session read model for repo '${workspaceRepoPath}': ${runtimeReadinessMessage}`,
          ),
        );
        return;
      }
      setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      try {
        const didLoadSessionReadModel = await loadRepoSessionReadModel({
          repoPath: workspaceRepoPath,
          taskSessionRecords: taskSessionRecordsState.records,
          adapter: agentEngine,
          commitSessionCollection,
          observeAgentSession,
          clearSessionObservationState,
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
    observeAgentSession,
    clearSessionObservationState,
    commitSessionCollection,
    runtimeReadinessState,
    runtimeReadinessMessage,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    isLoadingTasks,
    taskSessionRecordsState,
    workspaceRepoPath,
  ]);

  return currentSessionReadModelLoadState;
};
