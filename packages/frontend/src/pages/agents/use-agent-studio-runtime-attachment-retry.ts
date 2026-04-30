import { useEffect, useRef } from "react";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import {
  cloneRuntimeAttachmentCandidates,
  haveSameRuntimeAttachmentCandidates,
  type RuntimeAttachmentCandidate,
  type RuntimeAttachmentSource,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
} from "@/state/operations/shared/runtime-attachment-retry";

const RUNTIME_ATTACHMENT_POLLING_INTERVAL_MS = 2_000;

export {
  haveSameRuntimeAttachmentCandidates,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
};

export function useAgentStudioRuntimeAttachmentRetry({
  activeTaskId,
  activeExternalSessionId,
  shouldWaitForSessionRuntime,
  activeRuntimeAttachmentKey,
  runtimeAttachmentCandidates,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  repoReadinessState,
}: {
  activeTaskId: string;
  activeExternalSessionId: string | null;
  shouldWaitForSessionRuntime: boolean;
  activeRuntimeAttachmentKey: string | null;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  repoReadinessState: SessionRepoReadinessState;
}): void {
  const lastAttachmentAttemptRef = useRef<{
    externalSessionId: string;
    attachmentKey: string;
    candidates: RuntimeAttachmentCandidate[];
  } | null>(null);
  const attachmentAttemptCounterRef = useRef(0);

  useEffect(() => {
    if (!activeExternalSessionId) {
      attachmentAttemptCounterRef.current = 0;
      lastAttachmentAttemptRef.current = null;
      return;
    }

    if (lastAttachmentAttemptRef.current?.externalSessionId !== activeExternalSessionId) {
      attachmentAttemptCounterRef.current = 0;
      lastAttachmentAttemptRef.current = null;
    }

    if (!shouldWaitForSessionRuntime || !activeRuntimeAttachmentKey) {
      return;
    }

    const lastAttachmentAttempt = lastAttachmentAttemptRef.current;
    if (
      lastAttachmentAttempt?.attachmentKey === activeRuntimeAttachmentKey &&
      haveSameRuntimeAttachmentCandidates(
        lastAttachmentAttempt.candidates,
        runtimeAttachmentCandidates,
      )
    ) {
      return;
    }

    attachmentAttemptCounterRef.current += 1;
    const recoveryDedupKey = `${activeRuntimeAttachmentKey}::attempt:${attachmentAttemptCounterRef.current}`;

    lastAttachmentAttemptRef.current = {
      externalSessionId: activeExternalSessionId,
      attachmentKey: activeRuntimeAttachmentKey,
      candidates: cloneRuntimeAttachmentCandidates(runtimeAttachmentCandidates),
    };

    void ensureSessionReadyForView({
      taskId: activeTaskId,
      externalSessionId: activeExternalSessionId,
      repoReadinessState,
      recoveryDedupKey,
    }).catch(() => {
      // The operation layer surfaces actionable errors.
    });
  }, [
    activeRuntimeAttachmentKey,
    activeExternalSessionId,
    activeTaskId,
    ensureSessionReadyForView,
    repoReadinessState,
    runtimeAttachmentCandidates,
    shouldWaitForSessionRuntime,
  ]);

  useEffect(() => {
    if (!activeExternalSessionId || !shouldWaitForSessionRuntime) {
      return;
    }

    void refreshRuntimeAttachmentSources().catch(() => {
      // The refresh path is best-effort; attachment attempts surface actionable failures.
    });

    const intervalId = window.setInterval(() => {
      void refreshRuntimeAttachmentSources().catch(() => {
        // The refresh path is best-effort; attachment attempts surface actionable failures.
      });
    }, RUNTIME_ATTACHMENT_POLLING_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeExternalSessionId, refreshRuntimeAttachmentSources, shouldWaitForSessionRuntime]);
}

export type { RuntimeAttachmentCandidate, RuntimeAttachmentSource };
