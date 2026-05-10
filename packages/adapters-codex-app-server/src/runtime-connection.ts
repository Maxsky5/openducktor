import type { RepoRuntimeRef, RuntimeInstanceSummary } from "@openducktor/contracts";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";

export type CodexRuntimeResolutionInput = RepoRuntimeRef & {
  workingDirectory?: string | null;
};

const normalizeRepoPathForComparison = (repoPath: string): string => {
  const trimmed = repoPath.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
};

export const resolveCodexRuntimeClientInput = (
  runtime: RuntimeInstanceSummary,
  input: CodexRuntimeResolutionInput,
  action: string,
): { runtimeId: string; workingDirectory?: string } => {
  const ref = requireRepoRuntimeRef(input, action);
  if (ref.runtimeKind !== "codex") {
    throw new Error(`Codex App Server can only ${action} for runtime 'codex'.`);
  }
  if (runtime.kind !== "codex") {
    throw new Error(
      `Resolved runtime kind '${runtime.kind}' cannot be used to ${action}; 'codex' was requested for repo '${ref.repoPath}'.`,
    );
  }
  if (
    normalizeRepoPathForComparison(runtime.repoPath) !==
    normalizeRepoPathForComparison(ref.repoPath)
  ) {
    throw new Error(
      `Resolved runtime repo '${runtime.repoPath}' cannot be used to ${action}; repo '${ref.repoPath}' was requested.`,
    );
  }
  if (runtime.runtimeRoute.type !== "stdio") {
    throw new Error(
      `Codex runtime route '${runtime.runtimeRoute.type}' is unsupported for ${action}; stdio is required for repo '${ref.repoPath}'.`,
    );
  }

  const workingDirectory =
    input.workingDirectory !== undefined && input.workingDirectory !== null
      ? requireSessionWorkingDirectory(input.workingDirectory, action)
      : undefined;
  return {
    runtimeId: runtime.runtimeId,
    ...(workingDirectory ? { workingDirectory } : {}),
  };
};
