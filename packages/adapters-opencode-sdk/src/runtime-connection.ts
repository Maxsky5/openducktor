import type { BoundRuntimeRoute, RepoRuntimeRef } from "@openducktor/core";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";

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
  runtime: BoundRuntimeRoute;
  input: OpencodeRuntimeResolutionInput;
  action: string;
};

const requireOpencodeRuntimeEndpoint = (
  runtime: BoundRuntimeRoute,
  input: RepoRuntimeRef,
  action: string,
): string => {
  const ref = requireRepoRuntimeRef(input, action);
  if (runtime.kind !== ref.runtimeKind) {
    throw new Error(
      `Resolved runtime kind '${runtime.kind}' cannot be used to ${action}; '${ref.runtimeKind}' was requested for repo '${ref.repoPath}'.`,
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
  runtime: BoundRuntimeRoute;
  repoPath: RepoRuntimeRef["repoPath"];
  runtimeKind: RepoRuntimeRef["runtimeKind"];
  workingDirectory: string;
  action: string;
}): OpencodeRuntimeClientInput => ({
  runtimeEndpoint: requireOpencodeRuntimeEndpoint(input.runtime, input, input.action),
  workingDirectory: requireSessionWorkingDirectory(input.workingDirectory, input.action),
});

export const resolveOpencodeRuntimeClientInput = ({
  runtime,
  input,
  action,
}: ResolveOpencodeRuntimeClientInputRequest): ResolvedOpencodeRuntimeClientInput => {
  const runtimeRef = requireRepoRuntimeRef(input, action);
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
