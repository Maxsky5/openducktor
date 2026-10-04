import type { BoundRuntimeRoute, RepoRuntimeRef } from "@openducktor/core";
import { requireRepoRuntimeRef } from "@openducktor/core";

export const resolveCodexRuntimeClientInput = (
  runtime: BoundRuntimeRoute,
  input: RepoRuntimeRef,
  action: string,
) => {
  const ref = requireRepoRuntimeRef(input, action);
  if (ref.runtimeKind !== "codex") {
    throw new Error(`Codex App Server can only ${action} for runtime 'codex'.`);
  }
  if (runtime.kind !== "codex") {
    throw new Error(
      `Resolved runtime kind '${runtime.kind}' cannot be used to ${action}; 'codex' was requested for repo '${ref.repoPath}'.`,
    );
  }
  if (runtime.runtimeRoute.type !== "stdio") {
    throw new Error(
      `Codex runtime '${runtime.runtimeId}' is missing required route contract 'stdio' for repo '${ref.repoPath}' while attempting to ${action}; received route '${runtime.runtimeRoute.type}'.`,
    );
  }

  return { runtimeId: runtime.runtimeId } satisfies { runtimeId: string };
};
