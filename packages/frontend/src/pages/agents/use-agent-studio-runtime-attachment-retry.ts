import type { RuntimeKind } from "@openducktor/contracts";
import { useEffect, useRef } from "react";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { normalizeWorkingDirectory } from "@/state/operations/agent-orchestrator/support/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const RUNTIME_ATTACHMENT_POLLING_INTERVAL_MS = 2_000;

export type RuntimeAttachmentSource = {
  kind: RuntimeKind;
  repoPath: string;
};

export type RuntimeAttachmentCandidate = {
  runtimeKind: RuntimeKind;
  repoPath: string;
};

const compareRuntimeAttachmentCandidates = (
  left: RuntimeAttachmentCandidate,
  right: RuntimeAttachmentCandidate,
): number => {
  if (left.runtimeKind !== right.runtimeKind) {
    return left.runtimeKind.localeCompare(right.runtimeKind);
  }
  if (left.repoPath !== right.repoPath) {
    return left.repoPath.localeCompare(right.repoPath);
  }
  return 0;
};

const cloneRuntimeAttachmentCandidates = (
  candidates: RuntimeAttachmentCandidate[],
): RuntimeAttachmentCandidate[] => candidates.map((candidate) => ({ ...candidate }));

export const haveSameRuntimeAttachmentCandidates = (
  left: RuntimeAttachmentCandidate[],
  right: RuntimeAttachmentCandidate[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((candidate, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      candidate.runtimeKind === other.runtimeKind &&
      candidate.repoPath === other.repoPath
    );
  });
};

export const selectRuntimeAttachmentCandidates = ({
  repoPath,
  session,
  runtimeSources,
}: {
  repoPath: string;
  session: Pick<AgentSessionState, "runtimeKind"> | null;
  runtimeSources: RuntimeAttachmentSource[];
}): RuntimeAttachmentCandidate[] => {
  if (!session?.runtimeKind) {
    return [];
  }

  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

  return runtimeSources
    .filter((runtimeSource) => {
      const sourceRepoPath = normalizeWorkingDirectory(runtimeSource.repoPath);
      return runtimeSource.kind === session.runtimeKind && sourceRepoPath === normalizedRepoPath;
    })
    .map((runtimeSource) => ({
      runtimeKind: runtimeSource.kind,
      repoPath: normalizeWorkingDirectory(runtimeSource.repoPath),
    }))
    .sort(compareRuntimeAttachmentCandidates);
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

export const refreshRuntimeAttachmentSources = async (
  refetchRuntimeLists: Array<() => Promise<unknown>>,
): Promise<void> => {
  await Promise.all(Array.from(new Set(refetchRuntimeLists)).map((refetch) => refetch()));
};
