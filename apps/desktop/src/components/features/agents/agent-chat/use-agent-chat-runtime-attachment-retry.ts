import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import { useEffect, useRef } from "react";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { normalizeWorkingDirectory } from "@/state/operations/agent-orchestrator/support/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const RUNTIME_ATTACHMENT_POLLING_INTERVAL_MS = 2_000;

export type RuntimeAttachmentSource = {
  kind: RuntimeKind;
  runtimeId: string;
  workingDirectory: string;
  route: string;
};

export type RuntimeAttachmentCandidate = {
  runtimeKind: RuntimeKind;
  runtimeId: string;
  workingDirectory: string;
  route: string;
};

const compareRuntimeAttachmentCandidates = (
  left: RuntimeAttachmentCandidate,
  right: RuntimeAttachmentCandidate,
): number => {
  if (left.runtimeKind !== right.runtimeKind) {
    return left.runtimeKind.localeCompare(right.runtimeKind);
  }
  if (left.runtimeId !== right.runtimeId) {
    return left.runtimeId.localeCompare(right.runtimeId);
  }
  if (left.workingDirectory !== right.workingDirectory) {
    return left.workingDirectory.localeCompare(right.workingDirectory);
  }
  return left.route.localeCompare(right.route);
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
      candidate.runtimeId === other.runtimeId &&
      candidate.workingDirectory === other.workingDirectory &&
      candidate.route === other.route
    );
  });
};

export const selectRuntimeAttachmentCandidates = ({
  repoPath,
  session,
  runtimeSources,
}: {
  repoPath: string;
  session: Pick<AgentSessionState, "runtimeKind" | "workingDirectory"> | null;
  runtimeSources: RuntimeAttachmentSource[];
}): RuntimeAttachmentCandidate[] => {
  if (!session?.runtimeKind) {
    return [];
  }

  const sessionWorkingDirectory = normalizeWorkingDirectory(session.workingDirectory);
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

  return runtimeSources
    .filter((runtimeSource) => {
      const sourceWorkingDirectory = normalizeWorkingDirectory(runtimeSource.workingDirectory);
      return (
        runtimeSource.kind === session.runtimeKind &&
        (sourceWorkingDirectory === sessionWorkingDirectory ||
          sourceWorkingDirectory === normalizedRepoPath)
      );
    })
    .map((runtimeSource) => ({
      runtimeKind: runtimeSource.kind,
      runtimeId: runtimeSource.runtimeId,
      workingDirectory: normalizeWorkingDirectory(runtimeSource.workingDirectory),
      route: runtimeSource.route,
    }))
    .sort(compareRuntimeAttachmentCandidates);
};

export function useAgentChatRuntimeAttachmentRetry({
  activeTaskId,
  activeSessionId,
  shouldWaitForSessionRuntime,
  activeRuntimeAttachmentKey,
  runtimeAttachmentCandidates,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  repoReadinessState,
  persistedRecords,
}: {
  activeTaskId: string;
  activeSessionId: string | null;
  shouldWaitForSessionRuntime: boolean;
  activeRuntimeAttachmentKey: string | null;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
  ensureSessionReadyForView: (input: {
    taskId: string;
    sessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    recoveryDedupKey?: string | null;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  repoReadinessState: SessionRepoReadinessState;
  persistedRecords?: AgentSessionRecord[];
}): void {
  const lastAttachmentAttemptRef = useRef<{
    sessionId: string;
    attachmentKey: string;
    candidates: RuntimeAttachmentCandidate[];
  } | null>(null);
  const attachmentAttemptCounterRef = useRef(0);

  useEffect(() => {
    if (!activeSessionId) {
      attachmentAttemptCounterRef.current = 0;
      lastAttachmentAttemptRef.current = null;
      return;
    }

    if (lastAttachmentAttemptRef.current?.sessionId !== activeSessionId) {
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
      sessionId: activeSessionId,
      attachmentKey: activeRuntimeAttachmentKey,
      candidates: cloneRuntimeAttachmentCandidates(runtimeAttachmentCandidates),
    };

    void ensureSessionReadyForView({
      taskId: activeTaskId,
      sessionId: activeSessionId,
      repoReadinessState,
      recoveryDedupKey,
      ...(persistedRecords ? { persistedRecords } : {}),
    }).catch(() => {
      // The operation layer surfaces actionable errors.
    });
  }, [
    activeRuntimeAttachmentKey,
    activeSessionId,
    activeTaskId,
    ensureSessionReadyForView,
    persistedRecords,
    repoReadinessState,
    runtimeAttachmentCandidates,
    shouldWaitForSessionRuntime,
  ]);

  useEffect(() => {
    if (!activeSessionId || !shouldWaitForSessionRuntime) {
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
  }, [activeSessionId, refreshRuntimeAttachmentSources, shouldWaitForSessionRuntime]);
}

export const refreshRuntimeAttachmentSources = async (
  refetchRuntimeLists: Array<() => Promise<unknown>>,
): Promise<void> => {
  await Promise.all(refetchRuntimeLists.map((refetch) => refetch()));
};
