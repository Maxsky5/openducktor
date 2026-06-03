import { useEffect, useReducer, useRef } from "react";
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

type LiveTranscriptAttachmentLocalState = LiveTranscriptAttachmentState & {
  transcriptIdentityKey: string | null;
  liveTranscriptAttachKey: string | null;
};

type LiveTranscriptAttachmentAction =
  | {
      type: "attachStarted";
      transcriptIdentityKey: string | null;
      liveTranscriptAttachKey: string;
    }
  | {
      type: "attachFailed";
      transcriptIdentityKey: string | null;
      liveTranscriptAttachKey: string;
      error: string;
    }
  | {
      type: "attachFinished";
      transcriptIdentityKey: string | null;
      liveTranscriptAttachKey: string;
    };

const createLiveTranscriptAttachmentState = ({
  transcriptIdentityKey,
  liveTranscriptAttachKey,
}: {
  transcriptIdentityKey: string | null;
  liveTranscriptAttachKey: string | null;
}): LiveTranscriptAttachmentLocalState => ({
  transcriptIdentityKey,
  liveTranscriptAttachKey,
  isAttachingLiveTranscript: liveTranscriptAttachKey !== null,
  liveTranscriptAttachError: null,
});

const getLiveTranscriptAttachmentStateForKeys = (
  state: LiveTranscriptAttachmentLocalState,
  keys: {
    transcriptIdentityKey: string | null;
    liveTranscriptAttachKey: string | null;
  },
): LiveTranscriptAttachmentLocalState => {
  if (
    state.transcriptIdentityKey === keys.transcriptIdentityKey &&
    state.liveTranscriptAttachKey === keys.liveTranscriptAttachKey
  ) {
    return state;
  }

  return createLiveTranscriptAttachmentState(keys);
};

const liveTranscriptAttachmentReducer = (
  state: LiveTranscriptAttachmentLocalState,
  action: LiveTranscriptAttachmentAction,
): LiveTranscriptAttachmentLocalState => {
  const currentState = getLiveTranscriptAttachmentStateForKeys(state, {
    transcriptIdentityKey: action.transcriptIdentityKey,
    liveTranscriptAttachKey: action.liveTranscriptAttachKey,
  });

  switch (action.type) {
    case "attachStarted":
      return {
        ...currentState,
        isAttachingLiveTranscript: true,
        liveTranscriptAttachError: null,
      };
    case "attachFailed":
      return {
        ...currentState,
        isAttachingLiveTranscript: false,
        liveTranscriptAttachError: action.error,
      };
    case "attachFinished":
      return { ...currentState, isAttachingLiveTranscript: false };
  }
};

const getLiveTranscriptAttachKey = ({
  activeWorkspace,
  externalSessionId,
  isOpen,
  source,
  sourceResolution,
}: {
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  isOpen: boolean;
  source: RuntimeSessionTranscriptSource | null;
  sourceResolution: RuntimeTranscriptSourceResolution;
}): string | null => {
  if (
    !isOpen ||
    !activeWorkspace ||
    !externalSessionId ||
    !source ||
    source.isLive !== true ||
    sourceResolution.error ||
    sourceResolution.isPending ||
    !sourceResolution.runtimeId
  ) {
    return null;
  }

  return [
    activeWorkspace.repoPath,
    externalSessionId,
    source.runtimeRef.kind,
    sourceResolution.runtimeId,
    source.workingDirectory,
  ].join("\u0000");
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
  const transcriptIdentityKey = getRuntimeTranscriptIdentityKey({ externalSessionId, source });

  const liveTranscriptAttachKey = getLiveTranscriptAttachKey({
    activeWorkspace,
    externalSessionId,
    isOpen,
    source,
    sourceResolution,
  });
  const [state, dispatchState] = useReducer(
    liveTranscriptAttachmentReducer,
    { transcriptIdentityKey, liveTranscriptAttachKey },
    createLiveTranscriptAttachmentState,
  );
  const currentState = getLiveTranscriptAttachmentStateForKeys(state, {
    transcriptIdentityKey,
    liveTranscriptAttachKey,
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  visiblePendingApprovalsRef.current = Array.from(visiblePendingApprovals);
  visiblePendingQuestionsRef.current = Array.from(visiblePendingQuestions);

  useEffect(() => {
    if (transcriptIdentityKey === null || liveTranscriptAttachKey === null) {
      attachedLiveTranscriptKeyRef.current = null;
    }
  }, [liveTranscriptAttachKey, transcriptIdentityKey]);

  useEffect(() => {
    if (!liveTranscriptAttachKey) {
      return;
    }
    const runtimeId = sourceResolution.runtimeId;
    if (!activeWorkspace || !externalSessionId || !source || !runtimeId) {
      return;
    }
    if (attachedLiveTranscriptKeyRef.current === liveTranscriptAttachKey) {
      return;
    }

    attachedLiveTranscriptKeyRef.current = liveTranscriptAttachKey;
    dispatchState({
      type: "attachStarted",
      transcriptIdentityKey,
      liveTranscriptAttachKey,
    });

    void attachRuntimeTranscriptSession({
      repoPath: activeWorkspace.repoPath,
      externalSessionId,
      runtimeRef: { kind: source.runtimeRef.kind, runtimeId },
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
        dispatchState({
          type: "attachFailed",
          transcriptIdentityKey,
          liveTranscriptAttachKey,
          error: errorMessageFromUnknown(error, "Failed to attach live transcript."),
        });
      })
      .finally(() => {
        if (
          !isMountedRef.current ||
          attachedLiveTranscriptKeyRef.current !== liveTranscriptAttachKey
        ) {
          return;
        }
        dispatchState({
          type: "attachFinished",
          transcriptIdentityKey,
          liveTranscriptAttachKey,
        });
      });
  }, [
    activeWorkspace,
    attachRuntimeTranscriptSession,
    externalSessionId,
    liveTranscriptAttachKey,
    source,
    sourceResolution.runtimeId,
    transcriptIdentityKey,
  ]);

  return {
    isAttachingLiveTranscript: currentState.isAttachingLiveTranscript,
    liveTranscriptAttachError: currentState.liveTranscriptAttachError,
  };
}
