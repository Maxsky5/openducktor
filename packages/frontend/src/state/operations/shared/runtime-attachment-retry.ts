import type { RuntimeKind } from "@openducktor/contracts";
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
