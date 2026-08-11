import type {
  AgentSessionScope,
  RepoRuntimeRef,
  RepoRuntimeRouteResolution,
} from "@openducktor/core";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";
import { normalizePathForComparison } from "@openducktor/path-support";

export type CodexRuntimeResolutionInput = RepoRuntimeRef & {
  workingDirectory?: string | null;
  sessionScope?: AgentSessionScope;
  externalSessionId?: string;
  parentExternalSessionId?: string;
};

export const describeCodexRuntimeSession = (input: CodexRuntimeResolutionInput): string => {
  const scopeKind = input.sessionScope?.kind ?? "unbound";
  const sessionId = input.externalSessionId ?? input.parentExternalSessionId ?? "<new>";
  return `${scopeKind} session '${sessionId}'`;
};

export const resolveCodexRuntimeClientInput = (
  runtime: RepoRuntimeRouteResolution,
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
  if (normalizePathForComparison(runtime.repoPath) !== normalizePathForComparison(ref.repoPath)) {
    throw new Error(
      `Resolved runtime repo '${runtime.repoPath}' cannot be used to ${action}; repo '${ref.repoPath}' was requested.`,
    );
  }
  if (runtime.runtimeRoute.type !== "stdio") {
    throw new Error(
      `Codex runtime '${runtime.runtimeId}' is missing required route contract 'stdio' for ${describeCodexRuntimeSession(input)} in repo '${ref.repoPath}' while attempting to ${action}; received route '${runtime.runtimeRoute.type}'.`,
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
