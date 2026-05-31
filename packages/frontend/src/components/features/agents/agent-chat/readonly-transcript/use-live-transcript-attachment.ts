import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentOperationsContextValue } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { errorMessageFromUnknown } from "./runtime-transcript-error";
import { getRuntimeTranscriptIdentityKey } from "./runtime-transcript-identity";
import type { RuntimeTranscriptSourceResolution } from "./use-runtime-transcript-source-resolution";

type UseLiveTranscriptAttachmentArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
  sourceResolution: RuntimeTranscriptSourceResolution;
  visiblePendingApprovals: readonly AgentApprovalRequest[];
  visiblePendingQuestions: readonly AgentQuestionRequest[];
  attachRuntimeTranscriptSession: AgentOperationsContextValue["attachRuntimeTranscriptSession"];
};

type LiveTranscriptAttachmentState = {
  isAttachingLiveTranscript: boolean;
  liveTranscriptAttachError: string | null;
};

export function useLiveTranscriptAttachment({
  isOpen,
  activeWorkspace,
  externalSessionId,
  source,
  sourceResolution,
  visiblePendingApprovals,
  visiblePendingQuestions,
  attachRuntimeTranscriptSession,
}: UseLiveTranscriptAttachmentArgs): LiveTranscriptAttachmentState {
  const isMountedRef = useRef(true);
  const attachedLiveTranscriptKeyRef = useRef<string | null>(null);
  const visiblePendingApprovalsRef = useRef<AgentApprovalRequest[]>([]);
  const visiblePendingQuestionsRef = useRef<AgentQuestionRequest[]>([]);
  const [state, setState] = useState<LiveTranscriptAttachmentState>({
    isAttachingLiveTranscript: false,
    liveTranscriptAttachError: null,
  });
  const transcriptIdentityKey = getRuntimeTranscriptIdentityKey({ externalSessionId, source });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    visiblePendingApprovalsRef.current = Array.from(visiblePendingApprovals);
  }, [visiblePendingApprovals]);

  useEffect(() => {
    visiblePendingQuestionsRef.current = Array.from(visiblePendingQuestions);
  }, [visiblePendingQuestions]);

  useEffect(() => {
    if (transcriptIdentityKey === null) {
      attachedLiveTranscriptKeyRef.current = null;
      setState({
        isAttachingLiveTranscript: false,
        liveTranscriptAttachError: null,
      });
      return;
    }
    attachedLiveTranscriptKeyRef.current = null;
    setState((current) => ({
      ...current,
      liveTranscriptAttachError: null,
    }));
  }, [transcriptIdentityKey]);

  const liveTranscriptAttachKey = useMemo(() => {
    if (
      !isOpen ||
      !activeWorkspace ||
      !externalSessionId ||
      !source ||
      source.isLive !== true ||
      sourceResolution.error ||
      sourceResolution.isPending
    ) {
      return null;
    }

    return [
      activeWorkspace.repoPath,
      externalSessionId,
      source.runtimeKind,
      sourceResolution.runtimeId ?? "",
      source.workingDirectory,
    ].join("\u0000");
  }, [
    activeWorkspace,
    externalSessionId,
    isOpen,
    source,
    sourceResolution.error,
    sourceResolution.isPending,
    sourceResolution.runtimeId,
  ]);

  useEffect(() => {
    if (liveTranscriptAttachKey !== null) {
      return;
    }
    attachedLiveTranscriptKeyRef.current = null;
    setState((current) => ({
      ...current,
      isAttachingLiveTranscript: false,
    }));
  }, [liveTranscriptAttachKey]);

  useEffect(() => {
    if (!liveTranscriptAttachKey) {
      return;
    }
    if (!activeWorkspace || !externalSessionId || !source) {
      return;
    }
    if (attachedLiveTranscriptKeyRef.current === liveTranscriptAttachKey) {
      return;
    }

    attachedLiveTranscriptKeyRef.current = liveTranscriptAttachKey;
    setState((current) => ({
      ...current,
      isAttachingLiveTranscript: true,
      liveTranscriptAttachError: null,
    }));

    void attachRuntimeTranscriptSession({
      repoPath: activeWorkspace.repoPath,
      externalSessionId,
      runtimeKind: source.runtimeKind,
      ...(sourceResolution.runtimeId ? { runtimeId: sourceResolution.runtimeId } : {}),
      workingDirectory: source.workingDirectory,
      pendingApprovals: visiblePendingApprovalsRef.current,
      pendingQuestions: visiblePendingQuestionsRef.current,
    })
      .catch((error: unknown) => {
        if (
          !isMountedRef.current ||
          attachedLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        setState((current) => ({
          ...current,
          liveTranscriptAttachError: errorMessageFromUnknown(
            error,
            "Failed to attach live transcript.",
          ),
        }));
      })
      .finally(() => {
        if (
          !isMountedRef.current ||
          attachedLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        setState((current) => ({
          ...current,
          isAttachingLiveTranscript: false,
        }));
      });
  }, [
    activeWorkspace,
    attachRuntimeTranscriptSession,
    externalSessionId,
    liveTranscriptAttachKey,
    source,
    sourceResolution.runtimeId,
  ]);

  return state;
}
