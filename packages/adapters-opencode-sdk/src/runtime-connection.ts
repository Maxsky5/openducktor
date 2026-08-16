import type { RepoRuntimeRef, RepoRuntimeRouteResolution } from "@openducktor/core";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";
import { normalizePathForComparison } from "@openducktor/path-support";
import type { RepoRuntimeResolverPort } from "./types";

export type OpencodeRuntimeClientInput = {
  runtimeEndpoint: string;
  workingDirectory: string;
};

export type ResolvedOpencodeRuntimeClientInput = OpencodeRuntimeClientInput & {
  runtimeId: string;
};

export type OpencodeRuntimeResolutionInput = RepoRuntimeRef & {
  workingDirectory: string;
};

export type ResolveOpencodeRuntimeClientInputRequest = {
  repoRuntimeResolver: RepoRuntimeResolverPort | undefined;
  input: OpencodeRuntimeResolutionInput;
  action: string;
};

const requireOpencodeRuntimeEndpoint = (
  runtime: RepoRuntimeRouteResolution,
  input: RepoRuntimeRef,
  action: string,
): string => {
  const ref = requireRepoRuntimeRef(input, action);
  if (runtime.kind !== ref.runtimeKind) {
    throw new Error(
      `Resolved runtime kind '${runtime.kind}' cannot be used to ${action}; '${ref.runtimeKind}' was requested for repo '${ref.repoPath}'.`,
    );
  }
  if (normalizePathForComparison(runtime.repoPath) !== normalizePathForComparison(ref.repoPath)) {
    throw new Error(
      `Resolved runtime repo '${runtime.repoPath}' cannot be used to ${action}; repo '${ref.repoPath}' was requested.`,
    );
  }
  if (runtime.runtimeRoute.type !== "local_http") {
    throw new Error(
      `OpenCode runtime '${runtime.runtimeId}' is missing required route contract 'local_http' for repo '${ref.repoPath}' while attempting to ${action}; received route '${runtime.runtimeRoute.type}'.`,
    );
  }

  const endpoint = runtime.runtimeRoute.endpoint.trim();
  if (endpoint.length === 0) {
    throw new Error(
      `OpenCode runtime '${runtime.runtimeId}' is missing required route contract 'local_http' for repo '${ref.repoPath}' while attempting to ${action}; route endpoint is empty.`,
    );
  }

  return endpoint;
};

const toOpencodeRuntimeClientInput = (input: {
  runtime: RepoRuntimeRouteResolution;
  repoPath: RepoRuntimeRef["repoPath"];
  runtimeKind: RepoRuntimeRef["runtimeKind"];
  workingDirectory: string;
  action: string;
}): OpencodeRuntimeClientInput => ({
  runtimeEndpoint: requireOpencodeRuntimeEndpoint(input.runtime, input, input.action),
  workingDirectory: requireSessionWorkingDirectory(input.workingDirectory, input.action),
});

export const resolveOpencodeRuntimeClientInput = async ({
  repoRuntimeResolver,
  input,
  action,
}: ResolveOpencodeRuntimeClientInputRequest): Promise<ResolvedOpencodeRuntimeClientInput> => {
  if (!repoRuntimeResolver) {
    throw new Error(
      `OpenCode runtime '<unresolved>' is missing required route contract 'local_http' for repo '${input.repoPath}' while attempting to ${action}; repo runtime resolver is unavailable.`,
    );
  }

  const runtimeRef = requireRepoRuntimeRef(input, action);
  const runtime = await repoRuntimeResolver.requireRepoRuntime(runtimeRef);

  return {
    ...toOpencodeRuntimeClientInput({
      runtime,
      repoPath: runtimeRef.repoPath,
      runtimeKind: runtimeRef.runtimeKind,
      workingDirectory: input.workingDirectory,
      action,
    }),
    runtimeId: runtime.runtimeId,
  };
};
