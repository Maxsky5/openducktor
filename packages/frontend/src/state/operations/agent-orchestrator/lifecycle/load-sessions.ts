import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import type {
  AgentSessionHistoryHydrationPolicy,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { TaskDocuments } from "../runtime/runtime";
import { getSessionMessageCount } from "../support/messages";
import {
  createHydrationPromptAssemblerStage,
  createRuntimeResolutionPlannerStage,
  hydrateSessionRecordsStage,
  preparePersistedSessionMergeStage,
  reconcileLiveSessionsStage,
  type SessionLifecycleAdapter,
  type SessionLoadIntent,
  type UpdateSession,
} from "./load-sessions-stages";

type CreateLoadAgentSessionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionLifecycleAdapter;
  repoEpochRef: MutableRefObject<number>;
  activeWorkspaceRef?: MutableRefObject<ActiveWorkspace | null>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
  attachSessionListener?: (repoPath: string, externalSessionId: string) => void;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadTaskDocuments?: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  queryClient: QueryClient;
};

const REQUESTED_SESSION_LIVE_RECONCILE_STATUSES = new Set<AgentSessionState["status"]>([
  // A locally stopped session can still have a late runtime acknowledgement in flight.
  // Reconcile once on requested-history loads so the runtime remains the source of liveness truth.
  "stopped",
  "starting",
  "running",
]);

const shouldReconcileRequestedSessionLiveness = (session: AgentSessionState | null): boolean => {
  if (session === null) {
    return true;
  }
  if (REQUESTED_SESSION_LIVE_RECONCILE_STATUSES.has(session.status)) {
    return true;
  }
  return session.pendingApprovals.length > 0 || session.pendingQuestions.length > 0;
};

const resolveHistoryPolicy = ({
  explicitPolicy,
  shouldHydrateRequestedSession,
  shouldReconcileLiveSessions,
}: {
  explicitPolicy: AgentSessionLoadOptions["historyPolicy"] | undefined;
  shouldHydrateRequestedSession: boolean;
  shouldReconcileLiveSessions: boolean;
}): AgentSessionHistoryHydrationPolicy => {
  if (explicitPolicy) {
    return explicitPolicy;
  }
  if (shouldHydrateRequestedSession) {
    return "requested_only";
  }
  if (shouldReconcileLiveSessions) {
    return "live_if_empty";
  }
  return "none";
};

export const createLoadAgentSessions = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  activeWorkspaceRef,
  currentWorkspaceRepoPathRef,
  sessionsRef,
  setSessionsById,
  taskRef,
  updateSession,
  attachSessionListener,
  loadRepoPromptOverrides,
  loadTaskDocuments: _loadTaskDocuments,
  queryClient,
}: CreateLoadAgentSessionsArgs): ((
  taskId: string,
  options?: AgentSessionLoadOptions,
) => Promise<void>) => {
  const inFlightRequestedHistoryLoads = new Map<string, Promise<void>>();
  const inFlightRuntimeAttachmentRecoveryLoads = new Map<string, Promise<void>>();
  const normalizeHistoryPreludeMode = (
    historyPreludeMode: AgentSessionLoadOptions["historyPreludeMode"],
  ): string => historyPreludeMode ?? "task_context";

  const buildRequestedHistoryKey = (
    repoPath: string,
    taskId: string,
    externalSessionId: string,
    historyPreludeMode: AgentSessionLoadOptions["historyPreludeMode"],
  ): string =>
    `${repoPath}::${taskId}::${externalSessionId}::${normalizeHistoryPreludeMode(historyPreludeMode)}`;

  const buildRuntimeAttachmentRecoveryKey = (
    repoPath: string,
    taskId: string,
    externalSessionId: string,
    recoveryDedupKey?: string | null,
    historyPreludeMode?: AgentSessionLoadOptions["historyPreludeMode"],
  ): string =>
    recoveryDedupKey?.trim().length
      ? `${repoPath}::${taskId}::${externalSessionId}::${normalizeHistoryPreludeMode(historyPreludeMode)}::${recoveryDedupKey.trim()}`
      : `${repoPath}::${taskId}::${externalSessionId}::${normalizeHistoryPreludeMode(historyPreludeMode)}`;

  const buildLoadIntent = (
    repoPath: string,
    taskId: string,
    options?: AgentSessionLoadOptions,
  ): SessionLoadIntent => {
    const mode = options?.mode ?? "bootstrap";
    const requestedSessionId = options?.targetExternalSessionId?.trim() || null;
    const shouldHydrateRequestedSession =
      mode === "requested_history" && requestedSessionId !== null;
    const shouldRecoverRuntimeAttachment =
      mode === "recover_runtime_attachment" && requestedSessionId !== null;
    const requestedSession = requestedSessionId
      ? (sessionsRef.current[requestedSessionId] ?? null)
      : null;
    const shouldReconcileRequestedLiveSession =
      shouldHydrateRequestedSession && shouldReconcileRequestedSessionLiveness(requestedSession);
    const shouldReconcileLiveSessions =
      mode === "reconcile_live" ||
      shouldRecoverRuntimeAttachment ||
      shouldReconcileRequestedLiveSession;
    const historyPolicy = resolveHistoryPolicy({
      explicitPolicy: options?.historyPolicy,
      shouldHydrateRequestedSession,
      shouldReconcileLiveSessions,
    });
    return {
      repoPath,
      workspaceId: activeWorkspace?.workspaceId ?? "",
      taskId,
      mode,
      requestedSessionId,
      requestedHistoryKey: shouldHydrateRequestedSession
        ? buildRequestedHistoryKey(
            repoPath,
            taskId,
            requestedSessionId,
            options?.historyPreludeMode,
          )
        : null,
      shouldHydrateRequestedSession,
      shouldReconcileLiveSessions,
      historyPolicy,
    };
  };

  return async (taskId: string, options?: AgentSessionLoadOptions): Promise<void> => {
    if (!activeWorkspace?.repoPath || !activeWorkspace.workspaceId || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeWorkspace.repoPath;
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean => {
      const currentRepoPath =
        currentWorkspaceRepoPathRef.current ?? activeWorkspaceRef?.current?.repoPath ?? null;
      return repoEpochRef.current !== repoEpochAtStart || currentRepoPath !== repoPath;
    };
    if (isStaleRepoOperation()) {
      return;
    }

    const intent = buildLoadIntent(repoPath, taskId, options);
    const requestedHistoryKey = intent.requestedHistoryKey;
    const runtimeAttachmentRecoveryKeyWithSignal =
      intent.mode === "recover_runtime_attachment" && intent.requestedSessionId !== null
        ? buildRuntimeAttachmentRecoveryKey(
            repoPath,
            taskId,
            intent.requestedSessionId,
            options?.recoveryDedupKey,
            options?.historyPreludeMode,
          )
        : null;
    if (requestedHistoryKey) {
      const existingLoad = inFlightRequestedHistoryLoads.get(requestedHistoryKey);
      if (existingLoad) {
        return existingLoad;
      }
    }
    if (runtimeAttachmentRecoveryKeyWithSignal) {
      const existingLoad = inFlightRuntimeAttachmentRecoveryLoads.get(
        runtimeAttachmentRecoveryKeyWithSignal,
      );
      if (existingLoad) {
        return existingLoad;
      }
    }

    const executeLoad = async (): Promise<void> => {
      const { recordsToHydrate, historyHydrationSessionIds, getRepoPromptOverrides } =
        await preparePersistedSessionMergeStage({
          intent,
          ...(options ? { options } : {}),
          sessionsRef,
          setSessionsById,
          isStaleRepoOperation,
          loadPersistedRecords: async () => {
            if (options?.persistedRecords) {
              return options.persistedRecords;
            }
            return loadAgentSessionListFromQuery(queryClient, repoPath, taskId);
          },
          loadRepoPromptOverrides,
        });
      const shouldSkipHydration =
        isStaleRepoOperation() ||
        (!intent.shouldHydrateRequestedSession && !intent.shouldReconcileLiveSessions) ||
        recordsToHydrate.length === 0;
      if (shouldSkipHydration) {
        return;
      }

      const runtimePlanner = createRuntimeResolutionPlannerStage({
        intent,
        ...(options ? { options } : {}),
        adapter,
      });
      const promptAssembler = createHydrationPromptAssemblerStage({
        taskId,
        taskRef,
        ...(options?.historyPreludeMode ? { historyPreludeMode: options.historyPreludeMode } : {}),
      });

      const { reattachedSessionIds } = await reconcileLiveSessionsStage({
        intent,
        ...(options ? { options } : {}),
        adapter,
        sessionsRef,
        updateSession,
        ...(attachSessionListener ? { attachSessionListener } : {}),
        isStaleRepoOperation,
        recordsToHydrate,
        runtimePlanner,
        promptAssembler,
        getRepoPromptOverrides,
      });
      if (!isStaleRepoOperation()) {
        const effectiveHistoryHydrationSessionIds = new Set(historyHydrationSessionIds);
        if (intent.historyPolicy === "live_if_empty") {
          for (const externalSessionId of reattachedSessionIds) {
            const currentSession = sessionsRef.current[externalSessionId];
            if (!currentSession) {
              continue;
            }
            const hasHydratedHistory = currentSession.historyHydrationState === "hydrated";
            if (hasHydratedHistory && getSessionMessageCount(currentSession) > 0) {
              continue;
            }
            effectiveHistoryHydrationSessionIds.add(externalSessionId);
          }
        }

        const shouldHydrateSubagentPendingInput = intent.shouldReconcileLiveSessions;
        await hydrateSessionRecordsStage({
          repoPath: intent.repoPath,
          adapter,
          setSessionsById,
          updateSession,
          isStaleRepoOperation,
          recordsToHydrate,
          historyHydrationSessionIds: effectiveHistoryHydrationSessionIds,
          failOnRuntimeResolutionError: true,
          runtimePlanner,
          promptAssembler,
          getRepoPromptOverrides,
          subagentPendingInputMode: shouldHydrateSubagentPendingInput ? "hydrate" : "skip",
        });
      }
    };

    if (!requestedHistoryKey && !runtimeAttachmentRecoveryKeyWithSignal) {
      await executeLoad();
      return;
    }

    const inFlightLoad = executeLoad().finally(() => {
      if (requestedHistoryKey) {
        inFlightRequestedHistoryLoads.delete(requestedHistoryKey);
      }
      if (runtimeAttachmentRecoveryKeyWithSignal) {
        inFlightRuntimeAttachmentRecoveryLoads.delete(runtimeAttachmentRecoveryKeyWithSignal);
      }
    });
    if (requestedHistoryKey) {
      inFlightRequestedHistoryLoads.set(requestedHistoryKey, inFlightLoad);
    }
    if (runtimeAttachmentRecoveryKeyWithSignal) {
      inFlightRuntimeAttachmentRecoveryLoads.set(
        runtimeAttachmentRecoveryKeyWithSignal,
        inFlightLoad,
      );
    }
    await inFlightLoad;
  };
};
