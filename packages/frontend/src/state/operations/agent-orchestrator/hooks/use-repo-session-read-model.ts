import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useSnapshotReadableRepoRuntimeKinds } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
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
  clearSessionObservationState: (sessions: readonly SessionRef[]) => void;
  loadLiveSessionHistory: (session: PolicyBoundSessionRef) => Promise<unknown>;
  queryClient: QueryClient;
};

export type RepoSessionReadModelState = {
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  reloadSessionReadModel: () => void;
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
  loadLiveSessionHistory,
  queryClient,
}: UseRepoSessionReadModelArgs): RepoSessionReadModelState => {
  const [sessionReadModelLoadState, setSessionReadModelLoadState] =
    useState<AgentSessionReadModelLoadState>(unavailableAgentSessionReadModelLoadState);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const latestReloadGenerationRef = useRef(reloadGeneration);
  latestReloadGenerationRef.current = reloadGeneration;
  const reloadSessionReadModel = useCallback(() => {
    setReloadGeneration((current) => current + 1);
  }, []);
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
  const snapshotReadableRuntimeKinds = useSnapshotReadableRepoRuntimeKinds({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeKinds: requiredRuntimeKinds,
  });
  const snapshotRuntimeKindKey = snapshotReadableRuntimeKinds.join("|");
  const snapshotRuntimeKinds = useMemo<RuntimeKind[]>(
    () =>
      snapshotRuntimeKindKey === "" ? [] : (snapshotRuntimeKindKey.split("|") as RuntimeKind[]),
    [snapshotRuntimeKindKey],
  );

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

    const effectReloadGeneration = reloadGeneration;
    const isStaleRepoOperation = (): boolean =>
      cancelled || isRepoStale() || latestReloadGenerationRef.current !== effectReloadGeneration;

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
      setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      try {
        const didLoadSessionReadModel = await loadRepoSessionReadModel({
          repoPath: workspaceRepoPath,
          taskSessionRecords: taskSessionRecordsState.records,
          snapshotRuntimeKinds,
          adapter: agentEngine,
          commitSessionCollection,
          observeAgentSession,
          clearSessionObservationState,
          loadLiveSessionHistory,
          loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(queryClient),
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
    loadLiveSessionHistory,
    commitSessionCollection,
    snapshotRuntimeKinds,
    reloadGeneration,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    isLoadingTasks,
    taskSessionRecordsState,
    queryClient,
    workspaceRepoPath,
  ]);

  return useMemo(
    () => ({
      sessionReadModelLoadState: currentSessionReadModelLoadState,
      reloadSessionReadModel,
    }),
    [currentSessionReadModelLoadState, reloadSessionReadModel],
  );
};
