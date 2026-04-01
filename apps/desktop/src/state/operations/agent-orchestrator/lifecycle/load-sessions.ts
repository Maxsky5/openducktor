import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { appQueryClient } from "@/lib/query-client";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskDocuments } from "../runtime/runtime";
import { createRepoStaleGuard } from "../support/core";
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
  activeRepo: string | null;
  adapter: SessionLifecycleAdapter;
  repoEpochRef: MutableRefObject<number>;
  activeRepoRef?: MutableRefObject<string | null>;
  previousRepoRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
  attachSessionListener?: (repoPath: string, sessionId: string) => void;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadTaskDocuments?: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  liveAgentSessionStore?: LiveAgentSessionStore;
};

export const createLoadAgentSessions = ({
  activeRepo,
  adapter,
  repoEpochRef,
  activeRepoRef,
  previousRepoRef,
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

  const buildRequestedHistoryKey = (repoPath: string, taskId: string, sessionId: string): string =>
    `${repoPath}::${taskId}::${sessionId}`;

  const buildLoadIntent = (
    repoPath: string,
    taskId: string,
    options?: AgentSessionLoadOptions,
  ): SessionLoadIntent => {
    const mode = options?.mode ?? "bootstrap";
    const requestedSessionId = options?.targetSessionId?.trim() || null;
    const shouldHydrateRequestedSession =
      mode === "requested_history" && requestedSessionId !== null;
    const shouldReconcileLiveSessions = mode === "reconcile_live";
    return {
      repoPath,
      taskId,
      mode,
      requestedSessionId,
      requestedHistoryKey: shouldHydrateRequestedSession
        ? buildRequestedHistoryKey(repoPath, taskId, requestedSessionId)
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
    if (!activeRepo || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeRepo;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      activeRepoRef,
      previousRepoRef,
    });
    if (isStaleRepoOperation()) {
      return;
    }

    const intent = buildLoadIntent(repoPath, taskId, options);
    const requestedHistoryKey = intent.requestedHistoryKey;
    if (requestedHistoryKey) {
      const existingLoad = inFlightRequestedHistoryLoads.get(requestedHistoryKey);
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
      const promptAssembler = createHydrationPromptAssemblerStage({ taskId, taskRef });

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
          if (!currentSession || currentSession.messages.length > 0) {
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

    if (!requestedHistoryKey) {
      await executeLoad();
      return;
    }

    const inFlightLoad = executeLoad().finally(() => {
      inFlightRequestedHistoryLoads.delete(requestedHistoryKey);
    });
    inFlightRequestedHistoryLoads.set(requestedHistoryKey, inFlightLoad);
    await inFlightLoad;
  };
};
