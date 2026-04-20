import type { AgentSessionRecord } from "@openducktor/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useChecksOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { runtimeListQueryOptions } from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type RuntimeAttachmentSource,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-chat-runtime-attachment-retry";
import { useAgentChatSessionHydration } from "./use-agent-chat-session-hydration";
import { useAgentChatSessionRuntimeData } from "./use-agent-chat-session-runtime-data";
import { useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const DEFAULT_SHOW_THINKING_MESSAGES = false;
const NOOP_SUBMIT_ANSWERS = async (_requestId: string, _answers: string[][]): Promise<void> => {};
const NOOP_REPLY_PERMISSION = async (
  _requestId: string,
  _reply: "once" | "always" | "reject",
): Promise<void> => {};

type UseReadonlySessionTranscriptSurfaceModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  sessionId: string | null;
  persistedRecords?: AgentSessionRecord[];
};

export function useReadonlySessionTranscriptSurfaceModel({
  activeWorkspace,
  taskId,
  sessionId,
  persistedRecords,
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
  } = useAgentOperations();
  const session = useAgentSession(sessionId ?? null);
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
  const hasPersistedSessionRecord = useMemo(
    () => Boolean(sessionId && persistedRecords?.some((record) => record.sessionId === sessionId)),
    [persistedRecords, sessionId],
  );

  useEffect(() => {
    if (!activeWorkspace || !taskId || !sessionId || session || !hasPersistedSessionRecord) {
      return;
    }

    void hydrateRequestedTaskSessionHistory({
      taskId,
      sessionId,
      ...(persistedRecords ? { persistedRecords } : {}),
    }).catch(() => {});
  }, [
    activeWorkspace,
    hasPersistedSessionRecord,
    hydrateRequestedTaskSessionHistory,
    persistedRecords,
    session,
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

  const hydration = useAgentChatSessionHydration({
    activeWorkspace,
    activeTaskId: taskId,
    activeSession: runtimeData.session,
    ...(persistedRecords ? { persistedRecords } : {}),
    repoReadinessState: runtimeReadiness.readinessState,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources: refreshRuntimeAttachmentSourceList,
    runtimeAttachmentCandidates,
  });

  const isSessionWorking =
    runtimeData.session?.status === "running" || runtimeData.session?.status === "starting";

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: runtimeData.session,
    isTaskHydrating: false,
    contextSwitchVersion: 0,
    showThinkingMessages: activeWorkspace ? showThinkingMessages : DEFAULT_SHOW_THINKING_MESSAGES,
    isSessionWorking,
    isSessionHistoryLoading: hydration.isActiveSessionHistoryHydrating,
    isWaitingForRuntimeReadiness: hydration.isWaitingForRuntimeReadiness,
    sessionRuntimeDataError: runtimeData.runtimeDataError,
    runtimeReadiness,
    emptyState: {
      title:
        sessionId && activeWorkspace
          ? "Loading transcript..."
          : "Select a repository and session to view a transcript.",
    },
    pendingQuestions: {
      canSubmit: false,
      isSubmittingByRequestId: {},
      onSubmit: NOOP_SUBMIT_ANSWERS,
    },
    permissions: {
      canReply: false,
      isSubmittingByRequestId: {},
      errorByRequestId: {},
      onReply: NOOP_REPLY_PERMISSION,
    },
  });

  return {
    model,
    session: runtimeData.session,
    runtimeDataError: runtimeData.runtimeDataError,
  };
}
