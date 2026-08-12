import type { RepoRuntimeRef, RepoRuntimeRouteResolution } from "@openducktor/core";
import { requireRepoRuntimeRef } from "@openducktor/core";
import { normalizePathForComparison } from "@openducktor/path-support";

export const resolveCodexRuntimeClientInput = (
  runtime: RepoRuntimeRouteResolution,
  input: RepoRuntimeRef,
  action: string,
): { runtimeId: string } => {
  const ref = requireRepoRuntimeRef(input, action);
  if (ref.runtimeKind !== "codex") {
    throw new Error(`Codex App Server can only ${action} for runtime 'codex'.`);
  }
  if (runtime.kind !== "codex") {
    throw new Error(
      `Resolved runtime kind '${runtime.kind}' cannot be used to ${action}; 'codex' was requested for repo '${ref.repoPath}'.`,
    );
  }
  if (normalizePathForComparison(runtime.repoPath) !== normalizePathForComparison(ref.repoPath)) {
    throw new Error(
      `Resolved runtime repo '${runtime.repoPath}' cannot be used to ${action}; repo '${ref.repoPath}' was requested.`,
    );
  }
  if (runtime.runtimeRoute.type !== "stdio") {
    throw new Error(
      `Codex runtime '${runtime.runtimeId}' is missing required route contract 'stdio' for repo '${ref.repoPath}' while attempting to ${action}; received route '${runtime.runtimeRoute.type}'.`,
    );
  }

  return { runtimeId: runtime.runtimeId };
};
