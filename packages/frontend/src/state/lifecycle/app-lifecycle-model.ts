type ChecksLoadingArgs = {
  hasRuntimeCheck: boolean;
  hasCachedTaskStoreCheck: boolean;
  hasCachedRepoRuntimeHealth: boolean;
};

export const shouldLoadChecks = ({
  hasRuntimeCheck,
  hasCachedTaskStoreCheck,
  hasCachedRepoRuntimeHealth,
}: ChecksLoadingArgs): boolean =>
  !hasRuntimeCheck || !hasCachedTaskStoreCheck || !hasCachedRepoRuntimeHealth;
