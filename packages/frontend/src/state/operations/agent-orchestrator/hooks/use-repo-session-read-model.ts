import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
import {
  type AgentSessionReadModelLoadState,
  currentAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type { AgentSessionTranscriptEventConsumer } from "../events/session-transcript-events";
import {
  applyAgentSessionLiveDelta,
  buildAgentSessionLiveCollection,
} from "../session-read-model/agent-session-live-projection";
import {
  collectPendingApprovalPolicyActions,
  type PendingApprovalPolicyAction,
} from "../session-read-model/pending-approval-policy";
import { useTaskSessionRecords } from "../session-read-model/use-task-session-records";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { createRepoStaleGuard } from "../support/core";

export type AgentSessionLiveFrontendPort = Pick<HostClient, "agentSessionLiveReplyApproval"> & {
  observeAgentSessionLive: (
    input: { repoPath: string },
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
};

type UseRepoSessionReadModelArgs = {
  workspaceRepoPath: string | null;
  taskIds: string[];
  isLoadingTasks: boolean;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  commitSessionCollection: AgentSessionsStore["commitSessionCollection"];
  liveSessionPort: AgentSessionLiveFrontendPort;
  transcriptEvents: AgentSessionTranscriptEventConsumer;
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
  liveSessionPort,
  transcriptEvents,
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

  useEffect(() => {
    if (!workspaceRepoPath || isLoadingTasks) {
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

    const repoPath = workspaceRepoPath;
    const taskSessionRecords = taskSessionRecordsState.records;
    const isRepoStale = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });
    const effectReloadGeneration = reloadGeneration;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let awaitingInitialSnapshot = true;
    const isStaleRepoOperation = (): boolean =>
      cancelled || isRepoStale() || latestReloadGenerationRef.current !== effectReloadGeneration;
    const failObservation = (message: string): void => {
      if (!isStaleRepoOperation()) {
        setSessionReadModelLoadState(failedAgentSessionReadModelLoadState(repoPath, message));
      }
    };
    const applyPendingApprovalPolicy = (actions: PendingApprovalPolicyAction[]): void => {
      for (const action of actions) {
        runOrchestratorSideEffect(
          "agent-session-live-auto-reject-mutating-approval",
          liveSessionPort.agentSessionLiveReplyApproval(action.input),
          {
            tags: {
              repoPath,
              role: action.role,
              externalSessionId: action.input.externalSessionId,
              requestId: action.input.requestId,
            },
          },
        );
      }
    };
    const commitInitialSnapshot = (
      envelope: Extract<AgentSessionLiveEnvelope, { type: "snapshot" }>,
    ): void => {
      const policyActions = commitSessionCollection((current) => {
        const collection = buildAgentSessionLiveCollection({
          current,
          taskSessionRecords,
          snapshots: envelope.sessions,
        });
        return {
          collection,
          result: collectPendingApprovalPolicyActions({
            previous: current,
            next: collection,
            repoPath,
          }),
        };
      });
      applyPendingApprovalPolicy(policyActions);
      awaitingInitialSnapshot = false;
      if (!isStaleRepoOperation()) {
        setSessionReadModelLoadState(readyAgentSessionReadModelLoadState(repoPath));
      }
    };
    const applyEnvelope = (envelope: AgentSessionLiveEnvelope): void => {
      if (isStaleRepoOperation()) {
        return;
      }
      if (envelope.type === "snapshot") {
        commitInitialSnapshot(envelope);
        return;
      }
      if (awaitingInitialSnapshot) {
        failObservation(
          `Live-session observation delivered '${envelope.type}' before its initial snapshot.`,
        );
        return;
      }
      if (envelope.type === "session_upsert" || envelope.type === "session_removed") {
        const policyActions = commitSessionCollection((current) => {
          const collection = applyAgentSessionLiveDelta({
            current,
            taskSessionRecords,
            envelope,
          });
          return {
            collection,
            result: collectPendingApprovalPolicyActions({
              previous: current,
              next: collection,
              repoPath,
            }),
          };
        });
        applyPendingApprovalPolicy(policyActions);
        return;
      }
      if (envelope.type === "transcript_event") {
        transcriptEvents.handle(envelope.event);
        return;
      }
      if (envelope.type === "catalog_invalidated") {
        const catalogScope =
          envelope.scope.workingDirectory === undefined
            ? {
                repoPath: envelope.scope.repoPath,
                runtimeKind: envelope.scope.runtimeKind,
              }
            : {
                repoPath: envelope.scope.repoPath,
                runtimeKind: envelope.scope.runtimeKind,
                workingDirectory: envelope.scope.workingDirectory,
              };
        runOrchestratorSideEffect(
          "agent-session-live-invalidate-skills",
          queryClient.invalidateQueries({
            queryKey: runtimeCatalogQueryKeys.repoSkillsScope(catalogScope),
          }),
          {
            tags: {
              repoPath: envelope.scope.repoPath,
              runtimeKind: envelope.scope.runtimeKind,
            },
          },
        );
        return;
      }
      if (envelope.type === "fault") {
        failObservation(
          `Live-session observation failed${envelope.operation ? ` during ${envelope.operation}` : ""}: ${envelope.message}`,
        );
      }
    };

    setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(repoPath));
    void liveSessionPort
      .observeAgentSessionLive({ repoPath }, (envelope) => {
        if (isStaleRepoOperation()) {
          return;
        }
        applyEnvelope(envelope);
      })
      .then((stopObserving) => {
        if (isStaleRepoOperation()) {
          stopObserving();
          return;
        }
        unsubscribe = stopObserving;
      })
      .catch((error) => {
        failObservation(
          `Failed to observe live sessions for repo '${repoPath}': ${errorMessage(error)}`,
        );
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      transcriptEvents.close();
    };
  }, [
    commitSessionCollection,
    currentWorkspaceRepoPathRef,
    isLoadingTasks,
    liveSessionPort,
    queryClient,
    reloadGeneration,
    repoEpochRef,
    taskSessionRecordsState,
    transcriptEvents,
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
