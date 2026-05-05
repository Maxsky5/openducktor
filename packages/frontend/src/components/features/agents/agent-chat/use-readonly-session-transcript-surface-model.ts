import type { RuntimeApprovalReplyOutcome, RuntimeInstanceSummary } from "@openducktor/contracts";
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
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useAgentChatSessionRuntimeData } from "./use-agent-chat-session-runtime-data";
import { useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";
import { useAgentSessionApprovalActions } from "./use-agent-session-approval-actions";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const DEFAULT_SHOW_THINKING_MESSAGES = false;
const EMPTY_PENDING_APPROVALS = Object.freeze([]) as unknown as AgentApprovalRequest[];
const EMPTY_PENDING_QUESTIONS = Object.freeze([]) as unknown as AgentQuestionRequest[];

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
    replyAgentApproval,
    answerAgentQuestion,
  } = useAgentOperations();
  const liveSession = useAgentSession(requestedExternalSessionId ?? null);
  const isMountedRef = useRef(true);
  const attachLiveTranscriptKeyRef = useRef<string | null>(null);
  const visiblePendingApprovalsRef = useRef<AgentApprovalRequest[]>([]);
  const visiblePendingQuestionsRef = useRef<AgentQuestionRequest[]>([]);
  const [isAttachingLiveTranscript, setIsAttachingLiveTranscript] = useState(false);
  const [liveTranscriptAttachError, setLiveTranscriptAttachError] = useState<string | null>(null);
  const [repliedRuntimeApprovalRequestIds, setRepliedRuntimeApprovalRequestIds] = useState<
    Set<string>
  >(() => new Set());
  const [repliedRuntimeQuestionRequestIds, setRepliedRuntimeQuestionRequestIds] = useState<
    Set<string>
  >(() => new Set());
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});
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
      setRepliedRuntimeApprovalRequestIds(new Set());
      setRepliedRuntimeQuestionRequestIds(new Set());
      setIsSubmittingQuestionByRequestId({});
      return;
    }
    setRepliedRuntimeApprovalRequestIds(new Set());
    setRepliedRuntimeQuestionRequestIds(new Set());
    setIsSubmittingQuestionByRequestId({});
    setLiveTranscriptAttachError(null);
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
  const approvalSession = runtimeData.session;
  const activeApprovalSessionId = approvalSession?.externalSessionId ?? null;
  const pendingApprovalRequests = approvalSession?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const questionSession = runtimeData.session;
  const activeQuestionSessionId = questionSession?.externalSessionId ?? null;
  const pendingQuestionRequests = questionSession?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
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
      setRepliedRuntimeApprovalRequestIds((current) => {
        if (current.has(requestId)) {
          return current;
        }
        const next = new Set(current);
        next.add(requestId);
        return next;
      });
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
      setIsSubmittingQuestionByRequestId((current) => ({ ...current, [requestId]: true }));
      try {
        await answerAgentQuestion(activeQuestionSessionId, requestId, answers);
        setRepliedRuntimeQuestionRequestIds((current) => {
          if (current.has(requestId)) {
            return current;
          }
          const next = new Set(current);
          next.add(requestId);
          return next;
        });
      } finally {
        setIsSubmittingQuestionByRequestId((current) => {
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
    },
    [activeQuestionSessionId, answerAgentQuestion],
  );

  const model = useAgentChatSurfaceModel({
    mode: "non_interactive",
    session: runtimeData.session,
    isTaskHydrating: isResolvingTranscript,
    isSessionSelectionResolving: false,
    showThinkingMessages: activeWorkspace ? showThinkingMessages : DEFAULT_SHOW_THINKING_MESSAGES,
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
