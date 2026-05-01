import type { RepoRuntimeRef } from "../types/agent-orchestrator";

export const requireRepoRuntimeRef = (
  ref: Partial<RepoRuntimeRef> | null | undefined,
  action: string,
): RepoRuntimeRef => {
  const repoPath = ref?.repoPath?.trim();
  if (!repoPath) {
    throw new Error(`Repository path is required to ${action}.`);
  }
  if (!ref?.runtimeKind) {
    throw new Error(`Runtime kind is required to ${action}.`);
  }

  return {
    repoPath,
    runtimeKind: ref.runtimeKind,
  };
};

export const requireSessionWorkingDirectory = (
  workingDirectory: string | null | undefined,
  action: string,
): string => {
  const normalized = workingDirectory?.trim();
  if (!normalized) {
    throw new Error(`Session workingDirectory is required to ${action}.`);
  }

  return normalized;
};
