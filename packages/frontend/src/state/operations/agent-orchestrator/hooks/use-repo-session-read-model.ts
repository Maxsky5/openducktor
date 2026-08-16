import type { AgentSessionLiveEnvelope, AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey, buildReadOnlyPermissionRejectionMessage } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type { AgentSessionReadPort } from "@/state/queries/agent-sessions";
import {
  loadAgentSessionListsFromQuery,
  normalizeAgentSessionTaskIds,
  retryAgentSessionListQueries,
} from "@/state/queries/agent-sessions";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  type AgentSessionReadModelLoadState,
  currentAgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";
import { loadEffectivePromptOverrides } from "../../prompt-overrides";
import type { AgentSessionTranscriptEventConsumer } from "../events/session-transcript-events";
import {
  applyAgentSessionLiveDelta,
  applyTaskSessionRecords,
  buildAgentSessionLiveCollection,
} from "../session-read-model/agent-session-live-projection";
import {
  collectPendingApprovalPolicyActions,
  type PendingApprovalPolicyAction,
} from "../session-read-model/pending-approval-policy";
import {
  type TaskSessionRecords,
  toTaskSessionRecords,
} from "../session-read-model/task-session-records";
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
  recoverTranscriptGap: (message: string) => Promise<void>;
  queryClient: QueryClient;
  sessionReadPort: AgentSessionReadPort;
};

export type RepoSessionReadModelState = {
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  reloadSessionReadModel: () => void;
  getSessionFault: (session: AgentSessionIdentity | null) => AgentSessionTransientFault | null;
};

type TaskSessionRecordsProjectionState =
  | { kind: "ready"; repoPath: string; records: TaskSessionRecords }
  | {
      kind: "failed";
      repoPath: string;
      failureKind: "load" | "reconciliation";
      message: string;
    };

const faultMessage = (envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>): string =>
  `Live-session observation failed${envelope.operation ? ` during ${envelope.operation}` : ""}: ${envelope.message}`;

export const useRepoSessionReadModel = ({
  workspaceRepoPath,
  taskIds,
  isLoadingTasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  commitSessionCollection,
  liveSessionPort,
  transcriptEvents,
  recoverTranscriptGap,
  queryClient,
  sessionReadPort,
}: UseRepoSessionReadModelArgs): RepoSessionReadModelState => {
  const [sessionReadModelLoadState, setSessionReadModelLoadState] =
    useState<AgentSessionReadModelLoadState>(unavailableAgentSessionReadModelLoadState);
  const [sessionFaults, setSessionFaults] = useState<
    ReadonlyMap<string, AgentSessionTransientFault>
  >(() => new Map());
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const retryAttemptRef = useRef(0);
  const taskSessionRecordsProjectionRef = useRef<TaskSessionRecordsProjectionState | null>(null);
  const readReloadGeneration = useEffectEvent(() => reloadGeneration);
  const observeLiveSessions = useEffectEvent(
    (
      input: Parameters<AgentSessionLiveFrontendPort["observeAgentSessionLive"]>[0],
      listener: Parameters<AgentSessionLiveFrontendPort["observeAgentSessionLive"]>[1],
    ) => liveSessionPort.observeAgentSessionLive(input, listener),
  );
  const replyLiveApproval = useEffectEvent(
    (input: Parameters<AgentSessionLiveFrontendPort["agentSessionLiveReplyApproval"]>[0]) =>
      liveSessionPort.agentSessionLiveReplyApproval(input),
  );
  const handleTranscriptEvent = useEffectEvent(
    (event: Parameters<AgentSessionTranscriptEventConsumer["handle"]>[0]) =>
      transcriptEvents.handle(event),
  );
  const recoverTranscriptHistory = useEffectEvent((message: string) =>
    recoverTranscriptGap(message),
  );
  const clearSessionFaults = useCallback(() => {
    setSessionFaults((current) => (current.size === 0 ? current : new Map()));
  }, []);
  const recordSessionFault = useCallback((ref: AgentSessionLiveRef, message: string) => {
    const key = agentSessionRefKey(ref);
    setSessionFaults((current) => {
      if (current.get(key)?.message === message) {
        return current;
      }
      const next = new Map(current);
      next.set(key, { message });
      return next;
    });
  }, []);
  const clearSessionFault = useCallback((ref: AgentSessionLiveRef) => {
    const key = agentSessionRefKey(ref);
    setSessionFaults((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  const getSessionFault = useCallback(
    (session: AgentSessionIdentity | null): AgentSessionTransientFault | null => {
      if (!workspaceRepoPath || !session) {
        return null;
      }
      return (
        sessionFaults.get(agentSessionRefKey({ repoPath: workspaceRepoPath, ...session })) ?? null
      );
    },
    [sessionFaults, workspaceRepoPath],
  );
  const reconcileTaskSessionRecords = useCallback(
    (repoPath: string, records: TaskSessionRecords): boolean => {
      try {
        commitSessionCollection((current) => ({
          collection: applyTaskSessionRecords({
            current,
            taskSessionRecords: records,
          }),
          result: undefined,
        }));
        taskSessionRecordsProjectionRef.current = {
          kind: "ready",
          repoPath,
          records,
        };
        return true;
      } catch (error: unknown) {
        const message = `Failed to reconcile task session records for repo '${repoPath}': ${errorMessage(error)}`;
        taskSessionRecordsProjectionRef.current = {
          kind: "failed",
          repoPath,
          failureKind: "reconciliation",
          message,
        };
        setSessionReadModelLoadState(failedAgentSessionReadModelLoadState(repoPath, message));
        return false;
      }
    },
    [commitSessionCollection],
  );
  const reloadSessionReadModel = useCallback(() => {
    const retryAttempt = retryAttemptRef.current + 1;
    retryAttemptRef.current = retryAttempt;
    if (!workspaceRepoPath) {
      setReloadGeneration((current) => current + 1);
      return;
    }
    const repoPath = workspaceRepoPath;
    const repoEpoch = repoEpochRef.current;
    const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
    const projectionState = taskSessionRecordsProjectionRef.current;
    const retriesReconciliationFailure =
      projectionState?.kind === "failed" &&
      projectionState.repoPath === repoPath &&
      projectionState.failureKind === "reconciliation";
    const isCurrentRetry = (): boolean =>
      retryAttemptRef.current === retryAttempt &&
      currentWorkspaceRepoPathRef.current === repoPath &&
      repoEpochRef.current === repoEpoch;
    setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(repoPath));
    const retryTaskSessionRecords = retriesReconciliationFailure
      ? loadAgentSessionListsFromQuery(queryClient, repoPath, normalizedTaskIds, {
          forceFresh: true,
          readPort: sessionReadPort,
        }).then((recordsByTaskId) => {
          if (!isCurrentRetry()) {
            return false;
          }
          return reconcileTaskSessionRecords(
            repoPath,
            toTaskSessionRecords(
              normalizedTaskIds.map((id) => ({ id })),
              recordsByTaskId,
            ),
          );
        })
      : retryAgentSessionListQueries(
          queryClient,
          repoPath,
          normalizedTaskIds,
          sessionReadPort,
        ).then(() => true);
    void retryTaskSessionRecords.then(
      (recordsReconciled) => {
        if (recordsReconciled && isCurrentRetry()) {
          setReloadGeneration((current) => current + 1);
        }
      },
      (error: unknown) => {
        if (isCurrentRetry()) {
          setSessionReadModelLoadState(
            failedAgentSessionReadModelLoadState(
              repoPath,
              `Failed to retry task session records for repo '${repoPath}': ${errorMessage(error)}`,
            ),
          );
        }
      },
    );
  }, [
    currentWorkspaceRepoPathRef,
    queryClient,
    reconcileTaskSessionRecords,
    repoEpochRef,
    sessionReadPort,
    taskIds,
    workspaceRepoPath,
  ]);
  // react-doctor-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    if (!workspaceRepoPath) {
      clearSessionFaults();
    }
  }, [clearSessionFaults, workspaceRepoPath]);
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
    readPort: sessionReadPort,
  });
  const observedRepoPathRef = useRef<string | null>(null);
  const canObserveRepo =
    taskSessionRecordsState.kind === "ready" || observedRepoPathRef.current === workspaceRepoPath;

  // Synchronizes an async query lifecycle with the parent-owned session read model.
  // react-doctor-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    if (!workspaceRepoPath) {
      return;
    }
    if (taskSessionRecordsState.kind === "loading") {
      if (observedRepoPathRef.current !== workspaceRepoPath) {
        // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state
        setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      }
      return;
    }
    if (taskSessionRecordsState.kind === "failed") {
      const message = `Failed to load task session records for repo '${workspaceRepoPath}': ${errorMessage(
        taskSessionRecordsState.error,
      )}`;
      taskSessionRecordsProjectionRef.current = {
        kind: "failed",
        repoPath: workspaceRepoPath,
        failureKind: "load",
        message,
      };
      setSessionReadModelLoadState(
        failedAgentSessionReadModelLoadState(workspaceRepoPath, message),
      );
      return;
    }

    // This hook owns the documented query-to-session-store projection boundary.
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
    reconcileTaskSessionRecords(workspaceRepoPath, taskSessionRecordsState.records);
  }, [reconcileTaskSessionRecords, taskSessionRecordsState, workspaceRepoPath]);

  useEffect(() => {
    if (!workspaceRepoPath || !canObserveRepo) {
      return;
    }
    return () => transcriptEvents.close();
  }, [
    canObserveRepo,
    commitSessionCollection,
    currentWorkspaceRepoPathRef,
    queryClient,
    reloadGeneration,
    repoEpochRef,
    transcriptEvents,
    workspaceRepoPath,
  ]);

  // Owns the async stream lifecycle; its loading state is not render-derived.
  // react-doctor-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    if (!workspaceRepoPath || !canObserveRepo) {
      return;
    }

    const repoPath = workspaceRepoPath;
    clearSessionFaults();
    const isRepoStale = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });
    const effectReloadGeneration = reloadGeneration;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let awaitingInitialSnapshot = true;
    const readTaskSessionRecords = (): TaskSessionRecords => {
      const current = taskSessionRecordsProjectionRef.current;
      if (!current || current.repoPath !== repoPath) {
        throw new Error(`Task session records are not ready for repo '${repoPath}'.`);
      }
      if (current.kind === "failed") {
        throw new Error(current.message);
      }
      return current.records;
    };
    const isStaleRepoOperation = (): boolean =>
      cancelled || isRepoStale() || readReloadGeneration() !== effectReloadGeneration;
    const failObservation = (message: string): void => {
      if (!isStaleRepoOperation()) {
        setSessionReadModelLoadState(failedAgentSessionReadModelLoadState(repoPath, message));
      }
    };
    const applyPendingApprovalPolicy = (actions: PendingApprovalPolicyAction[]): void => {
      if (actions.length === 0) {
        return;
      }
      const promptOverrides = loadEffectivePromptOverrides(repoPath, queryClient);
      for (const action of actions) {
        runOrchestratorSideEffect(
          "agent-session-live-auto-reject-mutating-approval",
          promptOverrides.then((overrides) =>
            replyLiveApproval({
              ...action.input,
              message: buildReadOnlyPermissionRejectionMessage({
                role: action.role,
                overrides,
              }),
            }),
          ),
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
          taskSessionRecords: readTaskSessionRecords(),
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
      if (envelope.type === "fault") {
        const message = faultMessage(envelope);
        if (envelope.ref) {
          recordSessionFault(envelope.ref, message);
        } else {
          failObservation(message);
        }
        return;
      }
      if (awaitingInitialSnapshot) {
        failObservation(
          `Live-session observation delivered '${envelope.type}' before its initial snapshot.`,
        );
        return;
      }
      if (envelope.type === "session_upsert" || envelope.type === "session_removed") {
        clearSessionFault(envelope.type === "session_upsert" ? envelope.session.ref : envelope.ref);
        const policyActions = commitSessionCollection((current) => {
          const collection = applyAgentSessionLiveDelta({
            current,
            taskSessionRecords: readTaskSessionRecords(),
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
        clearSessionFault(envelope.event.sessionRef);
        handleTranscriptEvent(envelope.event);
        return;
      }
      if (envelope.type === "transcript_gap") {
        void recoverTranscriptHistory(envelope.message).catch((error: unknown) => {
          failObservation(
            `Failed to recover transcript history after a live-stream gap: ${errorMessage(error)}`,
          );
        });
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
        const invalidations = [
          queryClient.invalidateQueries({
            queryKey: runtimeCatalogQueryKeys.repoSkillsScope(catalogScope),
          }),
          queryClient.invalidateQueries({
            queryKey: runtimeCatalogQueryKeys.repoSlashCommandsScope(catalogScope),
          }),
        ];
        runOrchestratorSideEffect(
          "agent-session-live-invalidate-catalog",
          Promise.all(invalidations),
          {
            tags: {
              repoPath: envelope.scope.repoPath,
              runtimeKind: envelope.scope.runtimeKind,
            },
          },
        );
        return;
      }
      if (envelope.type === "slash_command_catalog_updated") {
        queryClient.setQueryData(
          runtimeCatalogQueryKeys.repoSlashCommands(envelope.scope),
          envelope.catalog,
        );
        runOrchestratorSideEffect(
          "agent-session-live-invalidate-skills",
          queryClient.invalidateQueries({
            queryKey: runtimeCatalogQueryKeys.repoSkillsScope(envelope.scope),
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
    };
    const reportEnvelopeFailure = (envelope: AgentSessionLiveEnvelope, error: unknown): void => {
      if (envelope.type === "session_upsert") {
        recordSessionFault(
          envelope.session.ref,
          `Failed to apply live-session update: ${errorMessage(error)}`,
        );
        return;
      }
      if (envelope.type === "snapshot") {
        failObservation(
          `Failed to apply initial live-session snapshot for repo '${repoPath}': ${errorMessage(error)}`,
        );
        return;
      }
      failObservation(
        `Failed to apply live-session '${envelope.type}' event for repo '${repoPath}': ${errorMessage(error)}`,
      );
    };

    observedRepoPathRef.current = repoPath;
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state
    setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(repoPath));
    void observeLiveSessions({ repoPath }, (envelope) => {
      if (isStaleRepoOperation()) {
        return;
      }
      try {
        applyEnvelope(envelope);
      } catch (error: unknown) {
        reportEnvelopeFailure(envelope, error);
      }
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
      if (observedRepoPathRef.current === repoPath) {
        observedRepoPathRef.current = null;
      }
      unsubscribe?.();
    };
  }, [
    canObserveRepo,
    commitSessionCollection,
    currentWorkspaceRepoPathRef,
    queryClient,
    reloadGeneration,
    repoEpochRef,
    clearSessionFault,
    clearSessionFaults,
    recordSessionFault,
    workspaceRepoPath,
  ]);

  return useMemo(
    () => ({
      sessionReadModelLoadState: currentSessionReadModelLoadState,
      reloadSessionReadModel,
      getSessionFault,
    }),
    [currentSessionReadModelLoadState, getSessionFault, reloadSessionReadModel],
  );
};
