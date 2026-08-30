import type { RepoRuntimeRef, RepoRuntimeRouteResolution } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import { host } from "../operations/shared/host";

export type HostRepoRuntimeResolver = {
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
};

export const createHostRepoRuntimeResolver = (
  hostClient: Pick<HostClient, "runtimeRequire"> = host,
): HostRepoRuntimeResolver => ({
  requireRepoRuntime: async ({ repoPath, runtimeKind }) => {
    return hostClient.runtimeRequire(repoPath, runtimeKind);
  },
});
