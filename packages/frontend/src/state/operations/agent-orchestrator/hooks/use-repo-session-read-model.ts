import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import {
  type AgentSessionReadModelLoadState,
  currentAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { loadRepoSessionReadModel } from "../session-read-model/repo-session-read-model-loader";
import { sessionRuntimeReadinessKey } from "../session-read-model/session-runtime-readiness";
import { toTaskSessionRecords } from "../session-read-model/task-session-records";
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

type AgentSessionListQueryResult = UseQueryResult<AgentSessionRecord[], Error>;
type TaskSessionRecordQuerySnapshot =
  | { kind: "loading" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; recordsByTaskIndex: AgentSessionRecord[][] };

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
  const shouldReadTaskSessionRecords = workspaceRepoPath !== null && !isLoadingTasks;
  const taskSessionRecordSnapshot: TaskSessionRecordQuerySnapshot = useQueries(
    {
      queries: shouldReadTaskSessionRecords
        ? taskSessionTargets.map((task) => agentSessionListQueryOptions(workspaceRepoPath, task.id))
        : [],
      combine: (queries: AgentSessionListQueryResult[]): TaskSessionRecordQuerySnapshot => {
        if (queries.some((query) => query.isPending)) {
          return { kind: "loading" };
        }
        const failedQuery = queries.find((query) => query.isError);
        if (failedQuery) {
          return { kind: "failed", error: failedQuery.error };
        }
        return {
          kind: "ready",
          recordsByTaskIndex: queries.map((query) => query.data ?? []),
        };
      },
    },
    queryClient,
  );
  const taskSessionRecords = useMemo(() => {
    if (taskSessionRecordSnapshot.kind !== "ready") {
      return null;
    }

    return toTaskSessionRecords(
      taskSessionTargets,
      Object.fromEntries(
        taskSessionTargets.map((task, index) => [
          task.id,
          taskSessionRecordSnapshot.recordsByTaskIndex[index] ?? [],
        ]),
      ),
    );
  }, [taskSessionRecordSnapshot, taskSessionTargets]);
  const runtimeReadinessKey = taskSessionRecords
    ? sessionRuntimeReadinessKey({
        tasks: taskSessionRecords,
        runtimeHealthByRuntime,
      })
    : "";
  const readModelLoadInput = useMemo(
    () =>
      taskSessionRecords
        ? {
            taskSessionRecords,
            runtimeReadinessKey,
          }
        : null,
    [runtimeReadinessKey, taskSessionRecords],
  );
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
      if (taskSessionRecordSnapshot.kind === "loading") {
        setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
        return;
      }
      if (taskSessionRecordSnapshot.kind === "failed") {
        setSessionReadModelLoadState(
          failedAgentSessionReadModelLoadState(
            workspaceRepoPath,
            `Failed to load task session records for repo '${workspaceRepoPath}': ${errorMessage(
              taskSessionRecordSnapshot.error,
            )}`,
          ),
        );
        return;
      }
      if (!readModelLoadInput) {
        return;
      }
      setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      try {
        const didLoadSessionReadModel = await loadRepoSessionReadModel({
          repoPath: workspaceRepoPath,
          taskSessionRecords: readModelLoadInput.taskSessionRecords,
          adapter: agentEngine,
          commitSessionCollection,
          observeAgentSession,
          clearSessionObservationState,
          runtimeHealthByRuntime: runtimeHealthByRuntimeRef.current,
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
    readModelLoadInput,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    isLoadingTasks,
    taskSessionRecordSnapshot,
    workspaceRepoPath,
  ]);

  return currentSessionReadModelLoadState;
};
