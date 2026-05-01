import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";

export type OpencodeRuntimeClientInput = {
  runtimeEndpoint: string;
  workingDirectory: string;
};

export type OpencodeRuntimeResolutionInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory?: string | null;
};

const normalizeRepoPathForComparison = (repoPath: string): string => {
  const trimmed = repoPath.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
};

export const requireOpencodeRuntimeEndpoint = (
  runtime: RuntimeInstanceSummary,
  input: Pick<OpencodeRuntimeResolutionInput, "repoPath" | "runtimeKind">,
  action: string,
): string => {
  const ref = requireRepoRuntimeRef(input, action);
  if (runtime.kind !== ref.runtimeKind) {
    throw new Error(
      `Resolved runtime kind '${runtime.kind}' cannot be used to ${action}; '${ref.runtimeKind}' was requested for repo '${ref.repoPath}'.`,
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
  if (runtime.runtimeRoute.type !== "local_http") {
    throw new Error(
      `OpenCode runtime route '${runtime.runtimeRoute.type}' is unsupported for ${action}; local_http is required for repo '${ref.repoPath}'.`,
    );
  }

  const endpoint = runtime.runtimeRoute.endpoint.trim();
  if (endpoint.length === 0) {
    throw new Error(
      `OpenCode runtime endpoint is required to ${action} for repo '${ref.repoPath}' and runtime '${ref.runtimeKind}'.`,
    );
  }

  return endpoint;
};

export const toOpencodeRuntimeClientInput = (input: {
  runtime: RuntimeInstanceSummary;
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string | null | undefined;
  action: string;
}): OpencodeRuntimeClientInput => ({
  runtimeEndpoint: requireOpencodeRuntimeEndpoint(input.runtime, input, input.action),
  workingDirectory: requireSessionWorkingDirectory(input.workingDirectory, input.action),
});
