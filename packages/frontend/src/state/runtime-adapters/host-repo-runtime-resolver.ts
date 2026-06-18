import type { RepoRuntimeRef, RepoRuntimeRouteResolution } from "@openducktor/core";
import { host } from "../operations/shared/host";

export type HostRepoRuntimeResolver = {
  ensureRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
};

export const hostRepoRuntimeResolver: HostRepoRuntimeResolver = {
  ensureRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeEnsure(repoPath, runtimeKind);
  },
  requireRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeRequire(repoPath, runtimeKind);
  },
};
