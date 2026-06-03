import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { useEffect } from "react";

type UseRepoRuntimeHealthWarmupArgs = {
  workspaceRepoPath: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingChecks: boolean;
  hasCachedRepoRuntimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) => boolean;
  refreshRepoRuntimeHealthForRepo: (repoPath: string, force?: boolean) => Promise<unknown>;
};

export function useRepoRuntimeHealthWarmup({
  workspaceRepoPath,
  runtimeDefinitions,
  isLoadingChecks,
  hasCachedRepoRuntimeHealth,
  refreshRepoRuntimeHealthForRepo,
}: UseRepoRuntimeHealthWarmupArgs): void {
  useEffect(() => {
    if (!workspaceRepoPath || runtimeDefinitions.length === 0 || isLoadingChecks) {
      return;
    }

    const runtimeKinds = runtimeDefinitions.map((definition) => definition.kind);
    if (hasCachedRepoRuntimeHealth(workspaceRepoPath, runtimeKinds)) {
      return;
    }

    void refreshRepoRuntimeHealthForRepo(workspaceRepoPath, false);
  }, [
    workspaceRepoPath,
    hasCachedRepoRuntimeHealth,
    isLoadingChecks,
    refreshRepoRuntimeHealthForRepo,
    runtimeDefinitions,
  ]);
}
