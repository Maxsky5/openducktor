import type { RuntimeApprovalReplyOutcome, RuntimeInstanceSummary } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import {
  useChecksOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { useAgentOperations, useAgentSession, useChecksState } from "@/state/app-state-provider";
import { createRuntimeTranscriptSession } from "@/state/operations/agent-orchestrator/support/runtime-transcript-session";
import { sessionHistoryQueryOptions } from "@/state/queries/agent-session-runtime";
import { runtimeListQueryOptions } from "@/state/queries/runtime";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useAgentChatSessionRuntimeData } from "./use-agent-chat-session-runtime-data";
import { useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";
import { useAgentSessionApprovalActions } from "./use-agent-session-approval-actions";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const EMPTY_PENDING_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const EMPTY_PENDING_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);

type UseReadonlySessionTranscriptSurfaceModelArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
};

type RuntimeTranscriptLocalState = {
  isAttachingLiveTranscript: boolean;
  liveTranscriptAttachError: string | null;
  repliedRuntimeApprovalRequestIds: Set<string>;
  repliedRuntimeQuestionRequestIds: Set<string>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
};

type RuntimeTranscriptLocalAction =
  | { type: "transcriptIdentityReset"; clearAttachError: boolean }
  | { type: "attachUnavailable" }
  | { type: "attachStarted" }
  | { type: "attachFailed"; error: string }
  | { type: "attachFinished" }
  | { type: "approvalReplied"; requestId: string }
  | { type: "questionSubmitStarted"; requestId: string }
  | { type: "questionReplied"; requestId: string }
  | { type: "questionSubmitFinished"; requestId: string };

const runtimeTranscriptLocalReducer = (
  state: RuntimeTranscriptLocalState,
  action: RuntimeTranscriptLocalAction,
): RuntimeTranscriptLocalState => {
  switch (action.type) {
    case "transcriptIdentityReset":
      return {
        ...state,
        repliedRuntimeApprovalRequestIds: new Set(),
        repliedRuntimeQuestionRequestIds: new Set(),
        isSubmittingQuestionByRequestId: {},
        liveTranscriptAttachError: action.clearAttachError ? null : state.liveTranscriptAttachError,
      };
    case "attachUnavailable":
      return { ...state, isAttachingLiveTranscript: false };
    case "attachStarted":
      return { ...state, isAttachingLiveTranscript: true, liveTranscriptAttachError: null };
    case "attachFailed":
      return { ...state, liveTranscriptAttachError: action.error };
    case "attachFinished":
      return { ...state, isAttachingLiveTranscript: false };
    case "approvalReplied": {
      if (state.repliedRuntimeApprovalRequestIds.has(action.requestId)) {
        return state;
      }
      const repliedRuntimeApprovalRequestIds = new Set(state.repliedRuntimeApprovalRequestIds);
      repliedRuntimeApprovalRequestIds.add(action.requestId);
      return { ...state, repliedRuntimeApprovalRequestIds };
    }
    case "questionSubmitStarted":
      return {
        ...state,
        isSubmittingQuestionByRequestId: {
          ...state.isSubmittingQuestionByRequestId,
          [action.requestId]: true,
        },
      };
    case "questionReplied": {
      if (state.repliedRuntimeQuestionRequestIds.has(action.requestId)) {
        return state;
      }
      const repliedRuntimeQuestionRequestIds = new Set(state.repliedRuntimeQuestionRequestIds);
      repliedRuntimeQuestionRequestIds.add(action.requestId);
      return { ...state, repliedRuntimeQuestionRequestIds };
    }
    case "questionSubmitFinished": {
      const isSubmittingQuestionByRequestId = { ...state.isSubmittingQuestionByRequestId };
      delete isSubmittingQuestionByRequestId[action.requestId];
      return { ...state, isSubmittingQuestionByRequestId };
    }
  }
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
    replyAgentApproval,
    answerAgentQuestion,
  } = useAgentOperations();
  const liveSession = useAgentSession(requestedExternalSessionId ?? null);
  const isMountedRef = useRef(true);
  const attachLiveTranscriptKeyRef = useRef<string | null>(null);
  const visiblePendingApprovalsRef = useRef<AgentApprovalRequest[]>([]);
  const visiblePendingQuestionsRef = useRef<AgentQuestionRequest[]>([]);
  const [localState, dispatchLocalState] = useReducer(runtimeTranscriptLocalReducer, {
    isAttachingLiveTranscript: false,
    liveTranscriptAttachError: null,
    repliedRuntimeApprovalRequestIds: new Set<string>(),
    repliedRuntimeQuestionRequestIds: new Set<string>(),
    isSubmittingQuestionByRequestId: {},
  });
  const {
    isAttachingLiveTranscript,
    liveTranscriptAttachError,
    repliedRuntimeApprovalRequestIds,
    repliedRuntimeQuestionRequestIds,
    isSubmittingQuestionByRequestId,
  } = localState;
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const { chatSettings, chatSettingsError } = useWorkspaceChatSettings({
    activeWorkspace,
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
      dispatchLocalState({ type: "transcriptIdentityReset", clearAttachError: false });
      return;
    }
    dispatchLocalState({ type: "transcriptIdentityReset", clearAttachError: true });
  }, [externalSessionId, source?.runtimeId]);

  const visiblePendingApprovals = useMemo(() => {
    const byRequestId = new Map<string, AgentApprovalRequest>();
    for (const request of source?.pendingApprovals ?? []) {
      byRequestId.set(request.requestId, request);
    }
    for (const request of liveSession?.pendingApprovals ?? []) {
      byRequestId.set(request.requestId, request);
    }
    for (const requestId of repliedRuntimeApprovalRequestIds) {
      byRequestId.delete(requestId);
    }
    return Array.from(byRequestId.values());
  }, [liveSession?.pendingApprovals, repliedRuntimeApprovalRequestIds, source?.pendingApprovals]);

  useEffect(() => {
    visiblePendingApprovalsRef.current = visiblePendingApprovals;
  }, [visiblePendingApprovals]);

  const visiblePendingQuestions = useMemo(() => {
    const byRequestId = new Map<string, AgentQuestionRequest>();
    for (const request of source?.pendingQuestions ?? []) {
      byRequestId.set(request.requestId, request);
    }
    for (const request of liveSession?.pendingQuestions ?? []) {
      byRequestId.set(request.requestId, request);
    }
    for (const requestId of repliedRuntimeQuestionRequestIds) {
      byRequestId.delete(requestId);
    }
    return Array.from(byRequestId.values());
  }, [liveSession?.pendingQuestions, repliedRuntimeQuestionRequestIds, source?.pendingQuestions]);

  useEffect(() => {
    visiblePendingQuestionsRef.current = visiblePendingQuestions;
  }, [visiblePendingQuestions]);

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
    dispatchLocalState({ type: "attachUnavailable" });
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
    dispatchLocalState({ type: "attachStarted" });

    void attachRuntimeTranscriptSession({
      repoPath: activeWorkspace.repoPath,
      externalSessionId,
      runtimeKind: source.runtimeKind,
      ...(resolvedSource.runtimeId ? { runtimeId: resolvedSource.runtimeId } : {}),
      workingDirectory: source.workingDirectory,
      pendingApprovals: visiblePendingApprovalsRef.current,
      pendingQuestions: visiblePendingQuestionsRef.current,
    })
      .catch((error: unknown) => {
        if (
          !isMountedRef.current ||
          attachLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        attachLiveTranscriptKeyRef.current = null;
        dispatchLocalState({
          type: "attachFailed",
          error: errorMessageFromUnknown(error, "Failed to attach live transcript."),
        });
      })
      .finally(() => {
        if (
          !isMountedRef.current ||
          attachLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        dispatchLocalState({ type: "attachFinished" });
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
        pendingApprovals: visiblePendingApprovals,
        pendingQuestions: visiblePendingQuestions,
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
      pendingApprovals: visiblePendingApprovals,
      pendingQuestions: visiblePendingQuestions,
    });
  }, [
    activeWorkspace,
    externalSessionId,
    historyQuery.data,
    liveSession,
    resolvedSource,
    source,
    visiblePendingApprovals,
    visiblePendingQuestions,
  ]);

  const runtimeData = useAgentChatSessionRuntimeData({
    session: hydratedSession,
    runtimeDefinitions,
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
  const chatSettingsLoadError =
    activeWorkspace && chatSettingsError
      ? `Failed to load chat settings: ${errorMessageFromUnknown(
          chatSettingsError,
          "Settings read failed.",
        )}`
      : null;
  const loadError =
    resolvedSource.error ??
    chatSettingsLoadError ??
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
  const approvalSession = runtimeData.session;
  const activeApprovalSessionId = approvalSession?.externalSessionId ?? null;
  const pendingApprovalRequests: readonly AgentApprovalRequest[] =
    approvalSession?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const questionSession = runtimeData.session;
  const activeQuestionSessionId = questionSession?.externalSessionId ?? null;
  const pendingQuestionRequests: readonly AgentQuestionRequest[] =
    questionSession?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const replyTranscriptApproval = useCallback(
    async (
      targetExternalSessionId: string,
      requestId: string,
      outcome: RuntimeApprovalReplyOutcome,
    ): Promise<void> => {
      if (!targetExternalSessionId) {
        throw new Error("Runtime transcript approval target is unavailable.");
      }
      await replyAgentApproval(targetExternalSessionId, requestId, outcome);
      dispatchLocalState({ type: "approvalReplied", requestId });
    },
    [replyAgentApproval],
  );
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      activeExternalSessionId: activeApprovalSessionId,
      pendingApprovals: pendingApprovalRequests,
      agentStudioReady: runtimeReadiness.isReady,
      replyAgentApproval: replyTranscriptApproval,
    });

  const replyTranscriptQuestion = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeQuestionSessionId) {
        throw new Error("Runtime transcript question target is unavailable.");
      }
      dispatchLocalState({ type: "questionSubmitStarted", requestId });
      try {
        await answerAgentQuestion(activeQuestionSessionId, requestId, answers);
        dispatchLocalState({ type: "questionReplied", requestId });
      } finally {
        dispatchLocalState({ type: "questionSubmitFinished", requestId });
      }
    },
    [activeQuestionSessionId, answerAgentQuestion],
  );

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: runtimeData.session,
    isTaskHydrating: isResolvingTranscript,
    isSessionSelectionResolving: false,
    chatSettings,
    isSessionWorking,
    isSessionHistoryLoading: isTranscriptLoading,
    isWaitingForRuntimeReadiness: false,
    runtimeDefinitions,
    sessionRuntimeDataError: runtimeData.runtimeDataError ?? loadError,
    runtimeReadiness,
    emptyState,
    pendingQuestions: {
      canSubmit:
        runtimeReadiness.isReady &&
        !resolvedSource.isPending &&
        !resolvedSource.error &&
        activeQuestionSessionId === externalSessionId &&
        pendingQuestionRequests.length > 0,
      isSubmittingByRequestId: isSubmittingQuestionByRequestId,
      onSubmit: replyTranscriptQuestion,
    },
    approvals: {
      canReply:
        runtimeReadiness.isReady &&
        !resolvedSource.isPending &&
        !resolvedSource.error &&
        activeApprovalSessionId !== null &&
        pendingApprovalRequests.length > 0,
      isSubmittingByRequestId: isSubmittingApprovalByRequestId,
      errorByRequestId: approvalReplyErrorByRequestId,
      onReply: onReplyApproval,
    },
  });

  return {
    model,
    session: runtimeData.session,
    runtimeDataError: runtimeData.runtimeDataError ?? loadError,
  };
}
