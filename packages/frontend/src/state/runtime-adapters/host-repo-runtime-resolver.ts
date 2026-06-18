import type { RepoRuntimeRef, RepoRuntimeRouteResolution } from "@openducktor/core";
import { host } from "../operations/shared/host";

export type HostRepoRuntimeResolver = {
  ensureRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
  hasLiveRepoRuntime(ref: RepoRuntimeRef): Promise<boolean>;
};

export const hostRepoRuntimeResolver: HostRepoRuntimeResolver = {
  ensureRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeEnsure(repoPath, runtimeKind);
  },
  requireRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return host.runtimeRequire(repoPath, runtimeKind);
  },
  hasLiveRepoRuntime: async ({ repoPath, runtimeKind }) => {
    const runtimes = await host.runtimeList(repoPath, runtimeKind);
    return runtimes.length > 0;
  },
};
