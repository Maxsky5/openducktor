import type { RuntimeKind } from "@openducktor/contracts";
import { useEffect, useRef } from "react";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export type RuntimeAttachmentSource = {
  kind: RuntimeKind;
  repoPath: string;
};

export type RuntimeAttachmentCandidate = {
  runtimeKind: RuntimeKind;
  repoPath: string;
};

type RuntimeAttachmentSession = {
  runtimeKind?: RuntimeKind | null;
};

const compareRuntimeAttachmentCandidates = (
  left: RuntimeAttachmentCandidate,
  right: RuntimeAttachmentCandidate,
): number => {
  if (left.runtimeKind !== right.runtimeKind) {
    return left.runtimeKind.localeCompare(right.runtimeKind);
  }

  return left.repoPath.localeCompare(right.repoPath);
};

export const cloneRuntimeAttachmentCandidates = (
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
  session: RuntimeAttachmentSession | null;
  runtimeSources: RuntimeAttachmentSource[];
}): RuntimeAttachmentCandidate[] => {
  if (!session?.runtimeKind) {
    return [];
  }

  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  const candidatesByKey = new Map<string, RuntimeAttachmentCandidate>();

  for (const runtimeSource of runtimeSources) {
    const sourceRepoPath = normalizeWorkingDirectory(runtimeSource.repoPath);
    if (runtimeSource.kind !== session.runtimeKind || sourceRepoPath !== normalizedRepoPath) {
      continue;
    }

    const candidate: RuntimeAttachmentCandidate = {
      runtimeKind: runtimeSource.kind,
      repoPath: sourceRepoPath,
    };
    candidatesByKey.set(`${candidate.runtimeKind}::${candidate.repoPath}`, candidate);
  }

  return Array.from(candidatesByKey.values()).sort(compareRuntimeAttachmentCandidates);
};

export const refreshRuntimeAttachmentSources = async (
  refetchRuntimeLists: Array<() => Promise<unknown>>,
): Promise<void> => {
  await Promise.all(Array.from(new Set(refetchRuntimeLists)).map((refetch) => refetch()));
};

export type RuntimeAttachmentRetryEnsureInput<RepoReadinessState> = {
  taskId: string;
  externalSessionId: string;
  repoReadinessState: RepoReadinessState;
  recoveryDedupKey?: string | null;
};

export function useRuntimeAttachmentRetry<
  RepoReadinessState,
  ExtraEnsureInput extends object = Record<string, never>,
>({
  activeTaskId,
  activeExternalSessionId,
  shouldWaitForSessionRuntime,
  activeRuntimeAttachmentKey,
  runtimeAttachmentCandidates,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  repoReadinessState,
  buildEnsureInputExtras,
}: {
  activeTaskId: string;
  activeExternalSessionId: string | null;
  shouldWaitForSessionRuntime: boolean;
  activeRuntimeAttachmentKey: string | null;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
  ensureSessionReadyForView: (
    input: RuntimeAttachmentRetryEnsureInput<RepoReadinessState> & ExtraEnsureInput,
  ) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  repoReadinessState: RepoReadinessState;
  buildEnsureInputExtras?: () => ExtraEnsureInput;
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
      ...(buildEnsureInputExtras?.() ?? ({} as ExtraEnsureInput)),
    }).catch(() => {
      // The operation layer surfaces actionable errors.
    });
  }, [
    activeRuntimeAttachmentKey,
    activeExternalSessionId,
    activeTaskId,
    buildEnsureInputExtras,
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
    }, 2_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeExternalSessionId, refreshRuntimeAttachmentSources, shouldWaitForSessionRuntime]);
}
