import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { appQueryClient } from "@/lib/query-client";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { TaskDocuments } from "../runtime/runtime";
import { getSessionMessageCount } from "../support/messages";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
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
  attachSessionListener?: (repoPath: string, sessionId: string) => void;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadTaskDocuments?: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  liveAgentSessionStore?: LiveAgentSessionStore;
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
  liveAgentSessionStore,
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
    sessionId: string,
    historyPreludeMode: AgentSessionLoadOptions["historyPreludeMode"],
  ): string =>
    `${repoPath}::${taskId}::${sessionId}::${normalizeHistoryPreludeMode(historyPreludeMode)}`;

  const buildRuntimeAttachmentRecoveryKey = (
    repoPath: string,
    taskId: string,
    sessionId: string,
    recoveryDedupKey?: string | null,
    historyPreludeMode?: AgentSessionLoadOptions["historyPreludeMode"],
  ): string =>
    recoveryDedupKey?.trim().length
      ? `${repoPath}::${taskId}::${sessionId}::${normalizeHistoryPreludeMode(historyPreludeMode)}::${recoveryDedupKey.trim()}`
      : `${repoPath}::${taskId}::${sessionId}::${normalizeHistoryPreludeMode(historyPreludeMode)}`;

  const buildLoadIntent = (
    repoPath: string,
    taskId: string,
    options?: AgentSessionLoadOptions,
  ): SessionLoadIntent => {
    const mode = options?.mode ?? "bootstrap";
    const requestedSessionId = options?.targetSessionId?.trim() || null;
    const shouldHydrateRequestedSession =
      mode === "requested_history" && requestedSessionId !== null;
    const shouldRecoverRuntimeAttachment =
      mode === "recover_runtime_attachment" && requestedSessionId !== null;
    const shouldReconcileLiveSessions = mode === "reconcile_live" || shouldRecoverRuntimeAttachment;
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
      historyPolicy:
        options?.historyPolicy ??
        (shouldHydrateRequestedSession
          ? "requested_only"
          : shouldReconcileLiveSessions
            ? "live_if_empty"
            : "none"),
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
        await existingLoad;
        return;
      }
    }
    if (runtimeAttachmentRecoveryKeyWithSignal) {
      const existingLoad = inFlightRuntimeAttachmentRecoveryLoads.get(
        runtimeAttachmentRecoveryKeyWithSignal,
      );
      if (existingLoad) {
        await existingLoad;
        return;
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
          loadPersistedRecords: async () =>
            options?.persistedRecords
              ? Promise.resolve(options.persistedRecords)
              : loadAgentSessionListFromQuery(appQueryClient, repoPath, taskId),
          loadRepoPromptOverrides,
        });
      if (isStaleRepoOperation()) {
        return;
      }

      if (!intent.shouldHydrateRequestedSession && !intent.shouldReconcileLiveSessions) {
        return;
      }

      if (recordsToHydrate.length === 0) {
        return;
      }

      const runtimePlanner = await createRuntimeResolutionPlannerStage({
        intent,
        ...(options ? { options } : {}),
        adapter,
        sessionsRef,
        ...(liveAgentSessionStore ? { liveAgentSessionStore } : {}),
        recordsToHydrate,
        historyHydrationSessionIds,
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
        updateSession,
        ...(attachSessionListener ? { attachSessionListener } : {}),
        isStaleRepoOperation,
        recordsToHydrate,
        runtimePlanner,
        promptAssembler,
        getRepoPromptOverrides,
      });
      if (isStaleRepoOperation()) {
        return;
      }

      const effectiveHistoryHydrationSessionIds = new Set(historyHydrationSessionIds);
      if (intent.historyPolicy === "live_if_empty") {
        for (const sessionId of reattachedSessionIds) {
          const currentSession = sessionsRef.current[sessionId];
          if (!currentSession) {
            continue;
          }
          const hasHydratedHistory = currentSession.historyHydrationState === "hydrated";
          if (hasHydratedHistory && getSessionMessageCount(currentSession) > 0) {
            continue;
          }
          effectiveHistoryHydrationSessionIds.add(sessionId);
        }
      }

      await hydrateSessionRecordsStage({
        adapter,
        setSessionsById,
        updateSession,
        isStaleRepoOperation,
        recordsToHydrate,
        historyHydrationSessionIds: effectiveHistoryHydrationSessionIds,
        runtimePlanner,
        promptAssembler,
        getRepoPromptOverrides,
      });
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
