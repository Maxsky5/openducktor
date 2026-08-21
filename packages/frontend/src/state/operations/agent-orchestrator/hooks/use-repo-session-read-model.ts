import type { AgentSessionLiveEnvelope, AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey, buildReadOnlyPermissionRejectionMessage } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
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
  buildAgentSessionLiveCollection,
} from "../session-read-model/agent-session-live-projection";
import {
  applyWorkflowSessionRecords,
  type LoadedWorkflowSessionRecords,
} from "../session-read-model/agent-session-workflow-records";
import {
  collectPendingApprovalPolicyActions,
  type PendingApprovalPolicyAction,
} from "../session-read-model/pending-approval-policy";
import {
  toLoadedWorkflowSessionRecords,
  type TaskSessionRecords,
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

type TaskRecordApplyState =
  | {
      kind: "ready";
      repoPath: string;
      taskIdsKey: string;
      records: TaskSessionRecords;
    }
  | {
      kind: "failed";
      repoPath: string;
      failedAt: "load" | "apply";
      message: string;
    };

type RecordRetryKey = {
  retryId: number;
  repoPath: string;
  repoEpoch: number;
  taskIdsKey: string;
};

type RecordRetryResult = RecordRetryKey &
  ({ kind: "loaded" } | { kind: "failed"; message: string });

const faultMessage = (envelope: Extract<AgentSessionLiveEnvelope, { type: "fault" }>): string =>
  `Live-session observation failed${envelope.operation ? ` during ${envelope.operation}` : ""}: ${envelope.message}`;

const taskIdsScopeKey = (taskIds: string[]): string =>
  JSON.stringify(normalizeAgentSessionTaskIds(taskIds));

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
  const [recordRetryResult, setRecordRetryResult] = useState<RecordRetryResult | null>(null);
  const retryIdRef = useRef(0);
  const taskRecordApplyRef = useRef<TaskRecordApplyState | null>(null);
  const taskIdsKey = taskIdsScopeKey(taskIds);
  const readReloadGeneration = useEffectEvent(() => reloadGeneration);
  const readCurrentTaskIdsKey = useEffectEvent(() => taskIdsKey);
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
  const applyTaskRecords = useCallback(
    (repoPath: string, records: TaskSessionRecords): boolean => {
      try {
        commitSessionCollection((current) => ({
          collection: applyWorkflowSessionRecords({
            projected: current,
            records: toLoadedWorkflowSessionRecords(records),
          }),
          result: undefined,
        }));
        taskRecordApplyRef.current = {
          kind: "ready",
          repoPath,
          taskIdsKey: taskIdsScopeKey(records.taskIds),
          records,
        };
        return true;
      } catch (error: unknown) {
        const message = `Failed to reconcile task session records for repo '${repoPath}': ${errorMessage(error)}`;
        taskRecordApplyRef.current = {
          kind: "failed",
          repoPath,
          failedAt: "apply",
          message,
        };
        setSessionReadModelLoadState(
          failedAgentSessionReadModelLoadState(repoPath, message, "task-records"),
        );
        return false;
      }
    },
    [commitSessionCollection],
  );
  const reloadSessionReadModel = useCallback(() => {
    const retryId = retryIdRef.current + 1;
    retryIdRef.current = retryId;
    setRecordRetryResult(null);
    if (!workspaceRepoPath) {
      setReloadGeneration((current) => current + 1);
      return;
    }
    const repoPath = workspaceRepoPath;
    const repoEpoch = repoEpochRef.current;
    const retryTaskIds = normalizeAgentSessionTaskIds(taskIds);
    const retryKey: RecordRetryKey = {
      retryId,
      repoPath,
      repoEpoch,
      taskIdsKey,
    };
    const taskRecordState = taskRecordApplyRef.current;
    const retriesApplyFailure =
      taskRecordState?.kind === "failed" &&
      taskRecordState.repoPath === repoPath &&
      taskRecordState.failedAt === "apply";
    const isCurrentRetry = (): boolean =>
      retryIdRef.current === retryId &&
      currentWorkspaceRepoPathRef.current === repoPath &&
      repoEpochRef.current === repoEpoch;
    const retryFailureMessage = (cause: unknown): string =>
      `Failed to retry task session records for repo '${repoPath}': ${errorMessage(cause)}`;
    setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(repoPath));
    if (retriesApplyFailure) {
      void loadAgentSessionListsFromQuery(queryClient, repoPath, retryTaskIds, {
        forceFresh: true,
        readPort: sessionReadPort,
      }).then(
        () => {
          if (!isCurrentRetry()) {
            return;
          }
          setRecordRetryResult({
            kind: "loaded",
            ...retryKey,
          });
        },
        (cause: unknown) => {
          if (!isCurrentRetry()) {
            return;
          }
          setRecordRetryResult({
            kind: "failed",
            ...retryKey,
            message: retryFailureMessage(cause),
          });
        },
      );
      return;
    }
    void retryAgentSessionListQueries(queryClient, repoPath, retryTaskIds, sessionReadPort).then(
      () => {
        if (isCurrentRetry()) {
          setReloadGeneration((current) => current + 1);
        }
      },
      (cause: unknown) => {
        if (!isCurrentRetry()) {
          return;
        }
        setSessionReadModelLoadState(
          failedAgentSessionReadModelLoadState(
            repoPath,
            retryFailureMessage(cause),
            "task-records",
          ),
        );
      },
    );
  }, [
    currentWorkspaceRepoPathRef,
    queryClient,
    repoEpochRef,
    sessionReadPort,
    taskIds,
    taskIdsKey,
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
  const taskRecords = useTaskSessionRecords({
    repoPath: workspaceRepoPath,
    taskIds,
    enabled: !isLoadingTasks,
    queryClient,
    readPort: sessionReadPort,
  });
  const observedRepoPathRef = useRef<string | null>(null);
  const canObserveRepo =
    taskRecords.kind === "ready" || observedRepoPathRef.current === workspaceRepoPath;

  // Synchronizes an async query lifecycle with the parent-owned session read model.
  // react-doctor-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    if (!workspaceRepoPath) {
      return;
    }
    if (taskRecords.kind === "loading") {
      if (observedRepoPathRef.current !== workspaceRepoPath) {
        // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state
        setSessionReadModelLoadState(loadingAgentSessionReadModelLoadState(workspaceRepoPath));
      }
      return;
    }
    if (taskRecords.kind === "failed") {
      const message = `Failed to load task session records for repo '${workspaceRepoPath}': ${errorMessage(
        taskRecords.error,
      )}`;
      taskRecordApplyRef.current = {
        kind: "failed",
        repoPath: workspaceRepoPath,
        failedAt: "load",
        message,
      };
      setSessionReadModelLoadState(
        failedAgentSessionReadModelLoadState(workspaceRepoPath, message, "task-records"),
      );
      return;
    }

    // This is the sole task-query-to-session-store write path.
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
    const applied = applyTaskRecords(workspaceRepoPath, taskRecords.records);
    if (!applied) {
      return;
    }
    // Current-scope records loaded: a prior task-record failure no longer
    // describes this read model. Live observation, transcript recovery, and
    // protocol failures stay failed until their own source recovers.
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setSessionReadModelLoadState((current) =>
      current.kind === "failed" &&
      current.source === "task-records" &&
      current.workspaceRepoPath === workspaceRepoPath
        ? readyAgentSessionReadModelLoadState(workspaceRepoPath)
        : current,
    );
  }, [applyTaskRecords, taskRecords, workspaceRepoPath]);

  // react-doctor-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    if (!recordRetryResult) {
      return;
    }
    const retryIsCurrent =
      recordRetryResult.retryId === retryIdRef.current &&
      recordRetryResult.repoPath === workspaceRepoPath &&
      recordRetryResult.repoEpoch === repoEpochRef.current;
    if (!retryIsCurrent) {
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
      setRecordRetryResult(null);
      return;
    }
    if (recordRetryResult.kind === "failed" && recordRetryResult.taskIdsKey === taskIdsKey) {
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
      setRecordRetryResult(null);
      setSessionReadModelLoadState(
        failedAgentSessionReadModelLoadState(
          recordRetryResult.repoPath,
          recordRetryResult.message,
          "task-records",
        ),
      );
      return;
    }
    if (taskRecords.kind === "loading") {
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setRecordRetryResult(null);
    if (taskRecords.kind === "failed" || !workspaceRepoPath) {
      return;
    }
    const lastApply = taskRecordApplyRef.current;
    const recordsAreCurrent =
      lastApply?.kind === "ready" &&
      lastApply.repoPath === workspaceRepoPath &&
      lastApply.records === taskRecords.records;
    let recordsApplied = recordsAreCurrent;
    if (!recordsApplied) {
      // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
      recordsApplied = applyTaskRecords(workspaceRepoPath, taskRecords.records);
    }
    if (recordsApplied) {
      setReloadGeneration((current) => current + 1);
    }
  }, [
    applyTaskRecords,
    repoEpochRef,
    taskIdsKey,
    recordRetryResult,
    taskRecords,
    workspaceRepoPath,
  ]);

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
    const readLoadedWorkflowRecords = (): LoadedWorkflowSessionRecords | null => {
      const current = taskRecordApplyRef.current;
      if (!current || current.repoPath !== repoPath || current.kind !== "ready") {
        return null;
      }
      // Records applied for a prior task set are stale: the current set stays
      // unloaded until its own read succeeds, so it cannot prove deletion.
      if (current.taskIdsKey !== readCurrentTaskIdsKey()) {
        return null;
      }
      return toLoadedWorkflowSessionRecords(current.records);
    };
    // Every stream commit projects the runtime first, then applies loaded
    // workflow session records. An unloaded, failed, or stale record read
    // never proves deletion, so records apply only when loaded.
    const applyLoadedRecords = (projected: AgentSessionCollection): AgentSessionCollection => {
      const workflowRecords = readLoadedWorkflowRecords();
      return workflowRecords
        ? applyWorkflowSessionRecords({ projected, records: workflowRecords })
        : projected;
    };
    // Every stream write collects the pending-approval policy against the same
    // commit it belongs to.
    const commitProjected = (
      project: (current: AgentSessionCollection) => AgentSessionCollection,
    ): void => {
      const policyActions = commitSessionCollection((current) => {
        const collection = project(current);
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
      commitProjected((current) =>
        applyLoadedRecords(
          buildAgentSessionLiveCollection({
            current,
            snapshots: envelope.sessions,
          }),
        ),
      );
      awaitingInitialSnapshot = false;
      if (isStaleRepoOperation()) {
        return;
      }
      // A healthy stream must not mask a failed task-record read.
      const appliedRecords = taskRecordApplyRef.current;
      if (
        appliedRecords &&
        appliedRecords.repoPath === repoPath &&
        appliedRecords.kind === "failed"
      ) {
        setSessionReadModelLoadState(
          failedAgentSessionReadModelLoadState(repoPath, appliedRecords.message, "task-records"),
        );
        return;
      }
      setSessionReadModelLoadState(readyAgentSessionReadModelLoadState(repoPath));
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
        commitProjected((current) =>
          applyLoadedRecords(applyAgentSessionLiveDelta({ current, envelope })),
        );
        return;
      }
      if (envelope.type === "transcript_event") {
        clearSessionFault(envelope.event.sessionRef);
        handleTranscriptEvent(envelope.event);
        return;
      }
      if (envelope.type === "transcript_gap") {
        void recoverTranscriptHistory(envelope.message).catch((cause: unknown) => {
          failObservation(
            `Failed to recover transcript history after a live-stream gap: ${errorMessage(cause)}`,
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
    const reportEnvelopeFailure = (envelope: AgentSessionLiveEnvelope, cause: unknown): void => {
      if (envelope.type === "session_upsert") {
        recordSessionFault(
          envelope.session.ref,
          `Failed to apply live-session update: ${errorMessage(cause)}`,
        );
        return;
      }
      if (envelope.type === "snapshot") {
        failObservation(
          `Failed to apply initial live-session snapshot for repo '${repoPath}': ${errorMessage(cause)}`,
        );
        return;
      }
      failObservation(
        `Failed to apply live-session '${envelope.type}' event for repo '${repoPath}': ${errorMessage(cause)}`,
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
