import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import {
  useChecksOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { createRuntimeTranscriptSession } from "@/state/operations/agent-orchestrator/support/runtime-transcript-session";
import { sessionHistoryQueryOptions } from "@/state/queries/agent-session-runtime";
import { runtimeListQueryOptions } from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { AgentPermissionRequest } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useAgentChatSessionRuntimeData } from "./use-agent-chat-session-runtime-data";
import { useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const DEFAULT_SHOW_THINKING_MESSAGES = false;
const EMPTY_PENDING_PERMISSIONS = Object.freeze([]) as unknown as AgentPermissionRequest[];
const NOOP_SUBMIT_ANSWERS = async (_requestId: string, _answers: string[][]): Promise<void> => {};

type UseReadonlySessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
};

const errorMessageFromUnknown = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
};

const matchesSourceRuntime = (
  runtime: RuntimeInstanceSummary,
  source: RuntimeSessionTranscriptSource,
): boolean => {
  if (runtime.kind !== source.runtimeKind) {
    return false;
  }
  return runtime.runtimeId === source.runtimeId;
};

export function useReadonlySessionTranscriptSurfaceModel({
  isOpen,
  activeWorkspace,
  externalSessionId: requestedExternalSessionId,
  source,
}: UseReadonlySessionTranscriptSurfaceModelArgs) {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    readSessionHistory,
    readSessionModelCatalog,
    readSessionTodos,
    attachRuntimeTranscriptSession,
    replyAgentPermission,
    replyRuntimeSessionPermission,
  } = useAgentOperations();
  const liveSession = useAgentSession(requestedExternalSessionId ?? null);
  const isMountedRef = useRef(true);
  const attachLiveTranscriptKeyRef = useRef<string | null>(null);
  const visiblePendingPermissionsRef = useRef<AgentPermissionRequest[]>([]);
  const [isAttachingLiveTranscript, setIsAttachingLiveTranscript] = useState(false);
  const [liveTranscriptAttachError, setLiveTranscriptAttachError] = useState<string | null>(null);
  const [repliedRuntimePermissionRequestIds, setRepliedRuntimePermissionRequestIds] = useState<
    Set<string>
  >(() => new Set());
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const { data: showThinkingMessages = DEFAULT_SHOW_THINKING_MESSAGES } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: activeWorkspace !== null,
    select: (snapshot) => snapshot.chat.showThinkingMessages,
  });

  const runtimeListQuery = useQuery({
    ...(source && workspaceRepoPath
      ? runtimeListQueryOptions(source.runtimeKind, workspaceRepoPath)
      : runtimeListQueryOptions("opencode", "")),
    enabled: Boolean(isOpen && workspaceRepoPath && source),
  });

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

  const resolvedSource = useMemo(() => {
    if (!source) {
      return { isPending: false, error: null, runtimeId: null };
    }
    if (runtimeListQuery.isPending) {
      return { isPending: true, error: null, runtimeId: null };
    }
    if (runtimeListQuery.error) {
      return {
        isPending: false,
        error: errorMessageFromUnknown(
          runtimeListQuery.error,
          `Failed to load ${source.runtimeKind} runtimes.`,
        ),
        runtimeId: null,
      };
    }

    const matches = (runtimeListQuery.data ?? []).filter((runtime) =>
      matchesSourceRuntime(runtime, source),
    );
    if (matches.length !== 1) {
      const errorPrefix = matches.length === 0 ? "No" : "Multiple";
      return {
        isPending: false,
        error: `${errorPrefix} ${source.runtimeKind} runtime is attached for ${source.runtimeId}.`,
        runtimeId: null,
      };
    }

    const [runtime] = matches;
    if (!runtime) {
      return {
        isPending: false,
        error: `No ${source.runtimeKind} runtime is attached for ${source.runtimeId}.`,
        runtimeId: null,
      };
    }
    return {
      isPending: false,
      error: null,
      runtimeId: runtime.runtimeId,
    };
  }, [runtimeListQuery.data, runtimeListQuery.error, runtimeListQuery.isPending, source]);
  const externalSessionId = source?.externalSessionId ?? requestedExternalSessionId ?? null;
  useEffect(() => {
    const hasTranscriptIdentity = Boolean(externalSessionId || source?.runtimeId);
    if (!hasTranscriptIdentity) {
      setRepliedRuntimePermissionRequestIds(new Set());
      return;
    }
    setRepliedRuntimePermissionRequestIds(new Set());
    setLiveTranscriptAttachError(null);
  }, [externalSessionId, source?.runtimeId]);

  const visiblePendingPermissions = useMemo(() => {
    const byRequestId = new Map<string, AgentPermissionRequest>();
    for (const request of source?.pendingPermissions ?? []) {
      byRequestId.set(request.requestId, request);
    }
    for (const request of liveSession?.pendingPermissions ?? []) {
      byRequestId.set(request.requestId, request);
    }
    for (const requestId of repliedRuntimePermissionRequestIds) {
      byRequestId.delete(requestId);
    }
    return Array.from(byRequestId.values());
  }, [
    liveSession?.pendingPermissions,
    repliedRuntimePermissionRequestIds,
    source?.pendingPermissions,
  ]);

  useEffect(() => {
    visiblePendingPermissionsRef.current = visiblePendingPermissions;
  }, [visiblePendingPermissions]);

  const liveTranscriptAttachKey = useMemo(() => {
    if (
      !isOpen ||
      !activeWorkspace ||
      !externalSessionId ||
      !source ||
      source.isLive !== true ||
      resolvedSource.error ||
      resolvedSource.isPending
    ) {
      return null;
    }

    return [
      activeWorkspace.repoPath,
      externalSessionId,
      source.runtimeKind,
      resolvedSource.runtimeId ?? "",
      source.workingDirectory,
    ].join("\u0000");
  }, [
    activeWorkspace,
    externalSessionId,
    isOpen,
    resolvedSource.error,
    resolvedSource.isPending,
    resolvedSource.runtimeId,
    source,
  ]);

  useEffect(() => {
    if (liveTranscriptAttachKey !== null) {
      return;
    }
    attachLiveTranscriptKeyRef.current = null;
    setIsAttachingLiveTranscript(false);
  }, [liveTranscriptAttachKey]);

  useEffect(() => {
    if (!liveTranscriptAttachKey) {
      return;
    }
    if (!activeWorkspace || !externalSessionId || !source) {
      return;
    }
    if (attachLiveTranscriptKeyRef.current === liveTranscriptAttachKey) {
      return;
    }

    attachLiveTranscriptKeyRef.current = liveTranscriptAttachKey;
    setIsAttachingLiveTranscript(true);
    setLiveTranscriptAttachError(null);

    void attachRuntimeTranscriptSession({
      repoPath: activeWorkspace.repoPath,
      externalSessionId,
      runtimeKind: source.runtimeKind,
      ...(resolvedSource.runtimeId ? { runtimeId: resolvedSource.runtimeId } : {}),
      workingDirectory: source.workingDirectory,
      pendingPermissions: visiblePendingPermissionsRef.current,
    })
      .catch((error: unknown) => {
        if (
          !isMountedRef.current ||
          attachLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        attachLiveTranscriptKeyRef.current = null;
        setLiveTranscriptAttachError(
          errorMessageFromUnknown(error, "Failed to attach live transcript."),
        );
      })
      .finally(() => {
        if (
          !isMountedRef.current ||
          attachLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        setIsAttachingLiveTranscript(false);
      });
  }, [
    activeWorkspace,
    attachRuntimeTranscriptSession,
    externalSessionId,
    liveTranscriptAttachKey,
    resolvedSource.runtimeId,
    source,
  ]);

  const historyQueryEnabled = Boolean(
    isOpen &&
      activeWorkspace &&
      externalSessionId &&
      source &&
      source.isLive !== true &&
      !resolvedSource.error &&
      !resolvedSource.isPending &&
      liveSession === null,
  );

  const historyQuery = useQuery({
    ...(source && activeWorkspace && externalSessionId
      ? sessionHistoryQueryOptions(
          activeWorkspace.repoPath,
          source.runtimeKind,
          source.workingDirectory,
          externalSessionId,
          readSessionHistory,
        )
      : sessionHistoryQueryOptions(
          activeWorkspace?.repoPath ?? "",
          DEFAULT_RUNTIME_KIND,
          source?.workingDirectory ?? "",
          externalSessionId ?? "disabled",
          readSessionHistory,
        )),
    enabled: historyQueryEnabled,
  });

  const hydratedSession = useMemo(() => {
    if (liveSession) {
      return {
        ...liveSession,
        pendingPermissions: visiblePendingPermissions,
      };
    }
    if (source?.isLive === true) {
      return null;
    }
    if (!activeWorkspace || !source || !externalSessionId || !historyQuery.data) {
      return null;
    }

    return createRuntimeTranscriptSession({
      repoPath: activeWorkspace.repoPath,
      externalSessionId,
      runtimeKind: source.runtimeKind,
      runtimeId: resolvedSource.runtimeId,
      workingDirectory: source.workingDirectory,
      history: historyQuery.data,
      isLive: false,
      pendingPermissions: visiblePendingPermissions,
    });
  }, [
    activeWorkspace,
    externalSessionId,
    historyQuery.data,
    liveSession,
    resolvedSource,
    source,
    visiblePendingPermissions,
  ]);

  const runtimeData = useAgentChatSessionRuntimeData({
    session: hydratedSession,
    repoReadinessState: runtimeReadiness.readinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const isSessionWorking =
    runtimeData.session?.status === "running" || runtimeData.session?.status === "starting";
  const isHistoryLoading = historyQueryEnabled && historyQuery.isPending;
  const hasTranscriptSession = runtimeData.session !== null;
  const isLiveAttachBlocking = isAttachingLiveTranscript && !hasTranscriptSession;
  const isTranscriptLoading = isHistoryLoading || isLiveAttachBlocking;
  const isResolvingTranscript =
    Boolean(isOpen && activeWorkspace && externalSessionId && source) &&
    runtimeData.session === null &&
    (resolvedSource.isPending || isTranscriptLoading);
  const loadError =
    resolvedSource.error ??
    liveTranscriptAttachError ??
    (historyQuery.error
      ? errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history.")
      : null);
  const emptyState = useMemo(() => {
    if (loadError) {
      return {
        title: `Failed to load conversation: ${loadError}`,
      };
    }
    if (isResolvingTranscript) {
      return null;
    }
    if (externalSessionId && activeWorkspace) {
      return {
        title: "Conversation unavailable.",
      };
    }
    return {
      title: "Select a repository and session to view the conversation.",
    };
  }, [activeWorkspace, isResolvingTranscript, loadError, externalSessionId]);
  const permissionSession = runtimeData.session;
  const activePermissionSessionId = permissionSession?.externalSessionId ?? null;
  const pendingPermissionRequests =
    permissionSession?.pendingPermissions ?? EMPTY_PENDING_PERMISSIONS;
  const replyTranscriptPermission = useCallback(
    async (
      targetExternalSessionId: string,
      requestId: string,
      reply: "once" | "always" | "reject",
    ): Promise<void> => {
      if (source && activeWorkspace && externalSessionId) {
        await replyRuntimeSessionPermission({
          repoPath: activeWorkspace.repoPath,
          runtimeKind: source.runtimeKind,
          workingDirectory: source.workingDirectory,
          targetExternalSessionId,
          requestId,
          reply,
        });
        setRepliedRuntimePermissionRequestIds((current) => {
          if (current.has(requestId)) {
            return current;
          }
          const next = new Set(current);
          next.add(requestId);
          return next;
        });
        return;
      }

      if (liveSession) {
        await replyAgentPermission(targetExternalSessionId, requestId, reply);
        return;
      }

      throw new Error("Runtime transcript permission target is unavailable.");
    },
    [
      activeWorkspace,
      externalSessionId,
      liveSession,
      replyAgentPermission,
      replyRuntimeSessionPermission,
      source,
    ],
  );
  const { isSubmittingPermissionByRequestId, permissionReplyErrorByRequestId, onReplyPermission } =
    useAgentSessionPermissionActions({
      activeExternalSessionId: activePermissionSessionId,
      pendingPermissions: pendingPermissionRequests,
      agentStudioReady: runtimeReadiness.isReady,
      replyAgentPermission: replyTranscriptPermission,
    });

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: runtimeData.session,
    isTaskHydrating: isResolvingTranscript,
    isSessionHistoryHydrated: runtimeData.session !== null,
    contextSwitchVersion: 0,
    showThinkingMessages: activeWorkspace ? showThinkingMessages : DEFAULT_SHOW_THINKING_MESSAGES,
    isSessionWorking,
    isSessionHistoryLoading: isTranscriptLoading,
    isWaitingForRuntimeReadiness: false,
    sessionRuntimeDataError: runtimeData.runtimeDataError ?? loadError,
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
    runtimeDataError: runtimeData.runtimeDataError ?? loadError,
  };
}
