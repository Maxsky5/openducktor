import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { useAgentSessionApprovalActions } from "../use-agent-session-approval-actions";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { getRuntimeTranscriptIdentityKey } from "./runtime-transcript-identity";
import {
  mergeRuntimePendingApprovals,
  mergeRuntimePendingQuestions,
} from "./runtime-transcript-pending-requests";
import type { RuntimeTranscriptSourceResolution } from "./use-runtime-transcript-source-resolution";

const EMPTY_PENDING_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const EMPTY_PENDING_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);

type UseRuntimeTranscriptInteractionsArgs = {
  session: AgentSessionState | null;
  source: RuntimeSessionTranscriptSource | null;
  externalSessionId: string | null;
  sourceResolution: RuntimeTranscriptSourceResolution;
  isRuntimeReady: boolean;
  replyAgentApproval: (
    externalSessionId: string,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
  ) => Promise<void>;
  answerAgentQuestion: (
    externalSessionId: string,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

type RuntimeTranscriptInteractions = {
  session: AgentSessionState | null;
  visiblePendingApprovals: readonly AgentApprovalRequest[];
  visiblePendingQuestions: readonly AgentQuestionRequest[];
  pendingQuestions: {
    canSubmit: boolean;
    isSubmittingByRequestId: Record<string, boolean>;
    onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
  };
  approvals: {
    canReply: boolean;
    isSubmittingByRequestId: Record<string, boolean>;
    errorByRequestId: Record<string, string>;
    onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
  };
};

export function useRuntimeTranscriptInteractions({
  session,
  source,
  externalSessionId,
  sourceResolution,
  isRuntimeReady,
  replyAgentApproval,
  answerAgentQuestion,
}: UseRuntimeTranscriptInteractionsArgs): RuntimeTranscriptInteractions {
  const [repliedRuntimeApprovalRequestIds, setRepliedRuntimeApprovalRequestIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [repliedRuntimeQuestionRequestIds, setRepliedRuntimeQuestionRequestIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});
  const transcriptIdentityKey = getRuntimeTranscriptIdentityKey({ externalSessionId, source });
  const previousTranscriptIdentityKeyRef = useRef<string | null>(transcriptIdentityKey);

  useEffect(() => {
    if (previousTranscriptIdentityKeyRef.current === transcriptIdentityKey) {
      return;
    }
    previousTranscriptIdentityKeyRef.current = transcriptIdentityKey;
    setRepliedRuntimeApprovalRequestIds(new Set());
    setRepliedRuntimeQuestionRequestIds(new Set());
    setIsSubmittingQuestionByRequestId({});
  }, [transcriptIdentityKey]);

  const visiblePendingApprovals = useMemo(() => {
    return mergeRuntimePendingApprovals({
      source,
      session,
      repliedRequestIds: repliedRuntimeApprovalRequestIds,
    });
  }, [repliedRuntimeApprovalRequestIds, session, source]);

  const visiblePendingQuestions = useMemo(() => {
    return mergeRuntimePendingQuestions({
      source,
      session,
      repliedRequestIds: repliedRuntimeQuestionRequestIds,
    });
  }, [repliedRuntimeQuestionRequestIds, session, source]);

  const sessionWithPendingRequests = useMemo(() => {
    if (!session) {
      return null;
    }
    return {
      ...session,
      pendingApprovals: visiblePendingApprovals,
      pendingQuestions: visiblePendingQuestions,
    };
  }, [session, visiblePendingApprovals, visiblePendingQuestions]);

  const activeSessionId = sessionWithPendingRequests?.externalSessionId ?? null;
  const sessionMatchesTranscript =
    activeSessionId !== null && activeSessionId === externalSessionId;
  const canReplyToRuntimeRequest =
    isRuntimeReady &&
    !sourceResolution.isPending &&
    !sourceResolution.error &&
    sessionMatchesTranscript;
  const pendingApprovalRequests: readonly AgentApprovalRequest[] =
    sessionWithPendingRequests?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
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
      activeExternalSessionId: sessionMatchesTranscript ? activeSessionId : null,
      pendingApprovals: pendingApprovalRequests,
      agentStudioReady: isRuntimeReady,
      replyAgentApproval: replyTranscriptApproval,
    });

  const pendingQuestionRequests: readonly AgentQuestionRequest[] =
    sessionWithPendingRequests?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const replyTranscriptQuestion = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeSessionId) {
        throw new Error("Runtime transcript question target is unavailable.");
      }
      setIsSubmittingQuestionByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      try {
        await answerAgentQuestion(activeSessionId, requestId, answers);
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
    [activeSessionId, answerAgentQuestion],
  );

  return {
    session: sessionWithPendingRequests,
    visiblePendingApprovals,
    visiblePendingQuestions,
    pendingQuestions: {
      canSubmit: canReplyToRuntimeRequest && pendingQuestionRequests.length > 0,
      isSubmittingByRequestId: isSubmittingQuestionByRequestId,
      onSubmit: replyTranscriptQuestion,
    },
    approvals: {
      canReply: canReplyToRuntimeRequest && pendingApprovalRequests.length > 0,
      isSubmittingByRequestId: isSubmittingApprovalByRequestId,
      errorByRequestId: approvalReplyErrorByRequestId,
      onReply: onReplyApproval,
    },
  };
}
