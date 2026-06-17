import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import type { RepoRuntimeRef } from "@openducktor/core";
import { host } from "../operations/shared/host";

export type HostRepoRuntimeResolver = {
  ensureRepoRuntime(ref: RepoRuntimeRef): Promise<RuntimeInstanceSummary>;
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RuntimeInstanceSummary>;
};

export const hostRepoRuntimeResolver: HostRepoRuntimeResolver = {
  ensureRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeEnsure(repoPath, runtimeKind);
  },
  requireRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeRequire(repoPath, runtimeKind);
  },
};
