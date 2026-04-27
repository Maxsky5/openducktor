import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { defaultAgentScenarioForRole } from "@openducktor/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useChecksOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { runtimeListQueryOptions } from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type {
  AgentPermissionRequest,
  AgentSessionHistoryPreludeMode,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type RuntimeAttachmentSource,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-chat-runtime-attachment-retry";
import { useAgentChatSessionHydration } from "./use-agent-chat-session-hydration";
import { useAgentChatSessionRuntimeData } from "./use-agent-chat-session-runtime-data";
import { useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const DEFAULT_SHOW_THINKING_MESSAGES = false;
const SYNTHETIC_HISTORY_PRELUDE_MODE: AgentSessionHistoryPreludeMode = "none";
const EMPTY_PENDING_PERMISSIONS = Object.freeze([]) as unknown as AgentPermissionRequest[];
const NOOP_SUBMIT_ANSWERS = async (_requestId: string, _answers: string[][]): Promise<void> => {};
const toFallbackPersistedRecord = ({
  sessionId,
  fallbackSession,
}: {
  sessionId: string;
  fallbackSession: NonNullable<UseReadonlySessionTranscriptSurfaceModelArgs["fallbackSession"]>;
}): AgentSessionRecord => ({
  sessionId,
  externalSessionId: sessionId,
  role: fallbackSession.role,
  scenario: defaultAgentScenarioForRole(fallbackSession.role),
  startedAt: SYNTHETIC_SESSION_STARTED_AT,
  runtimeKind: fallbackSession.runtimeKind,
  workingDirectory: fallbackSession.workingDirectory,
  selectedModel: null,
});

type UseReadonlySessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  sessionId: string | null;
  persistedRecords?: AgentSessionRecord[];
  fallbackSession?: {
    role: AgentRole;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  };
  isResolvingRequestedSession: boolean;
};

const SYNTHETIC_SESSION_STARTED_AT = "1970-01-01T00:00:00.000Z";

export function useReadonlySessionTranscriptSurfaceModel({
  isOpen,
  activeWorkspace,
  taskId,
  sessionId,
  persistedRecords,
  fallbackSession,
  isResolvingRequestedSession,
}: UseReadonlySessionTranscriptSurfaceModelArgs) {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    ensureSessionReadyForView,
    hydrateRequestedTaskSessionHistory,
    readSessionModelCatalog,
    readSessionTodos,
    replyAgentPermission,
  } = useAgentOperations();
  const liveSession = useAgentSession(sessionId ?? null);
  const session = liveSession;
  const { data: showThinkingMessages = DEFAULT_SHOW_THINKING_MESSAGES } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: activeWorkspace !== null,
    select: (snapshot) => snapshot.chat.showThinkingMessages,
  });

  const runtimeListQueries = useQueries({
    queries:
      workspaceRepoPath === null
        ? []
        : runtimeDefinitions.map((definition) => ({
            ...runtimeListQueryOptions(definition.kind, workspaceRepoPath),
          })),
  });
  const runtimeListRefetchersRef = useRef<Array<() => Promise<unknown>>>([]);
  useEffect(() => {
    runtimeListRefetchersRef.current = runtimeListQueries.map((query) => query.refetch);
  }, [runtimeListQueries]);

  const runtimeAttachmentSources = useMemo<RuntimeAttachmentSource[]>(
    () =>
      runtimeListQueries.flatMap((query) =>
        (query.data ?? []).map((runtime) => ({
          kind: runtime.kind,
          runtimeId: runtime.runtimeId,
          workingDirectory: runtime.workingDirectory,
          route:
            runtime.runtimeRoute.type === "local_http"
              ? runtime.runtimeRoute.endpoint
              : runtime.runtimeRoute.type,
        })),
      ),
    [runtimeListQueries],
  );

  const refreshRuntimeAttachmentSourceList = useCallback(async (): Promise<void> => {
    await refreshRuntimeAttachmentSources(runtimeListRefetchersRef.current);
  }, []);

  useEffect(() => {
    if (!workspaceRepoPath || runtimeDefinitions.length === 0 || isLoadingChecks) {
      return;
    }
    const runtimeKinds = runtimeDefinitions.map((definition) => definition.kind);
    if (hasCachedRepoRuntimeHealth(workspaceRepoPath, runtimeKinds)) {
      return;
    }
    void refreshRepoRuntimeHealthForRepo(workspaceRepoPath, false);
  }, [
    workspaceRepoPath,
    hasCachedRepoRuntimeHealth,
    isLoadingChecks,
    refreshRepoRuntimeHealthForRepo,
    runtimeDefinitions,
  ]);

  const runtimeReadiness = useRepoRuntimeReadiness({
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
  });

  const runtimeData = useAgentChatSessionRuntimeData({
    session,
    repoReadinessState: runtimeReadiness.readinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const usesSyntheticRequestedRecord = useMemo(() => {
    if (!sessionId) {
      return false;
    }
    const currentRecords = persistedRecords ?? [];
    const hasRequestedRecord = currentRecords.some((record) => record.sessionId === sessionId);
    return (
      !hasRequestedRecord &&
      Boolean(fallbackSession) &&
      (fallbackSession?.workingDirectory.trim().length ?? 0) > 0
    );
  }, [fallbackSession, persistedRecords, sessionId]);
  const effectivePersistedRecords = useMemo(() => {
    if (!sessionId) {
      return persistedRecords;
    }
    const currentRecords = persistedRecords ?? [];
    if (!usesSyntheticRequestedRecord || !fallbackSession) {
      return persistedRecords;
    }
    return [...currentRecords, toFallbackPersistedRecord({ sessionId, fallbackSession })];
  }, [fallbackSession, persistedRecords, sessionId, usesSyntheticRequestedRecord]);
  const historyPreludeMode = usesSyntheticRequestedRecord
    ? SYNTHETIC_HISTORY_PRELUDE_MODE
    : undefined;
  const hasPersistedSessionRecord = useMemo(
    () =>
      Boolean(
        sessionId && effectivePersistedRecords?.some((record) => record.sessionId === sessionId),
      ),
    [effectivePersistedRecords, sessionId],
  );
  const [requestedHistoryHydrationFailed, setRequestedHistoryHydrationFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (
      !isOpen ||
      !activeWorkspace ||
      !taskId ||
      !sessionId ||
      !hasPersistedSessionRecord ||
      isResolvingRequestedSession
    ) {
      setRequestedHistoryHydrationFailed(false);
      return () => {
        cancelled = true;
      };
    }

    setRequestedHistoryHydrationFailed(false);
    void hydrateRequestedTaskSessionHistory({
      taskId,
      sessionId,
      ...(historyPreludeMode ? { historyPreludeMode } : {}),
      ...(effectivePersistedRecords ? { persistedRecords: effectivePersistedRecords } : {}),
    }).catch((error) => {
      if (cancelled) {
        return;
      }
      console.warn("Failed to hydrate read-only session history", error);
      setRequestedHistoryHydrationFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    activeWorkspace,
    effectivePersistedRecords,
    hasPersistedSessionRecord,
    hydrateRequestedTaskSessionHistory,
    historyPreludeMode,
    isResolvingRequestedSession,
    sessionId,
    taskId,
  ]);

  const runtimeAttachmentCandidates = useMemo(
    () =>
      selectRuntimeAttachmentCandidates({
        repoPath: workspaceRepoPath ?? "",
        session: runtimeData.session,
        runtimeSources: runtimeAttachmentSources,
      }),
    [runtimeAttachmentSources, runtimeData.session, workspaceRepoPath],
  );
  const hydrationActiveWorkspace = isOpen ? activeWorkspace : null;
  const hydrationActiveTaskId = isOpen ? taskId : "";
  const hydrationActiveSession = isOpen ? runtimeData.session : null;
  const hydrationRuntimeAttachmentCandidates = isOpen ? runtimeAttachmentCandidates : [];

  const hydration = useAgentChatSessionHydration({
    activeWorkspace: hydrationActiveWorkspace,
    activeTaskId: hydrationActiveTaskId,
    activeSession: hydrationActiveSession,
    ...(historyPreludeMode ? { historyPreludeMode } : {}),
    ...(effectivePersistedRecords ? { persistedRecords: effectivePersistedRecords } : {}),
    repoReadinessState: runtimeReadiness.readinessState,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources: refreshRuntimeAttachmentSourceList,
    runtimeAttachmentCandidates: hydrationRuntimeAttachmentCandidates,
  });

  const isSessionWorking =
    runtimeData.session?.status === "running" || runtimeData.session?.status === "starting";
  const shouldShowPendingSessionResolution =
    Boolean(sessionId) &&
    activeWorkspace !== null &&
    (isResolvingRequestedSession ||
      (runtimeData.session === null &&
        hasPersistedSessionRecord &&
        !requestedHistoryHydrationFailed));
  const emptyState = useMemo(() => {
    if (shouldShowPendingSessionResolution) {
      return null;
    }
    if (requestedHistoryHydrationFailed) {
      return {
        title: "Failed to load conversation.",
      };
    }
    if (sessionId && activeWorkspace) {
      return {
        title: "Conversation unavailable.",
      };
    }
    return {
      title: "Select a repository and session to view the conversation.",
    };
  }, [
    activeWorkspace,
    requestedHistoryHydrationFailed,
    sessionId,
    shouldShowPendingSessionResolution,
  ]);
  const permissionSession = runtimeData.session;
  const activePermissionSessionId = permissionSession?.sessionId ?? null;
  const pendingPermissionRequests =
    permissionSession?.pendingPermissions ?? EMPTY_PENDING_PERMISSIONS;
  const { isSubmittingPermissionByRequestId, permissionReplyErrorByRequestId, onReplyPermission } =
    useAgentSessionPermissionActions({
      activeSessionId: activePermissionSessionId,
      pendingPermissions: pendingPermissionRequests,
      agentStudioReady: runtimeReadiness.isReady,
      replyAgentPermission,
    });

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: runtimeData.session,
    isTaskHydrating: shouldShowPendingSessionResolution,
    contextSwitchVersion: 0,
    showThinkingMessages: activeWorkspace ? showThinkingMessages : DEFAULT_SHOW_THINKING_MESSAGES,
    isSessionWorking,
    isSessionHistoryLoading: hydration.isActiveSessionHistoryHydrating,
    isWaitingForRuntimeReadiness: hydration.isWaitingForRuntimeReadiness,
    sessionRuntimeDataError: runtimeData.runtimeDataError,
    runtimeReadiness,
    emptyState,
    pendingQuestions: {
      canSubmit: false,
      isSubmittingByRequestId: {},
      onSubmit: NOOP_SUBMIT_ANSWERS,
    },
    permissions: {
      canReply: activePermissionSessionId !== null && pendingPermissionRequests.length > 0,
      isSubmittingByRequestId: isSubmittingPermissionByRequestId,
      errorByRequestId: permissionReplyErrorByRequestId,
      onReply: onReplyPermission,
    },
  });

  return {
    model,
    session: runtimeData.session,
    runtimeDataError: runtimeData.runtimeDataError,
  };
}
