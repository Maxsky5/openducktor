type ChecksLoadingArgs = {
  hasRuntimeCheck: boolean;
  hasCachedBeadsCheck: boolean;
  hasCachedRepoRuntimeHealth: boolean;
};

export const shouldLoadChecks = ({
  hasRuntimeCheck,
  hasCachedBeadsCheck,
  hasCachedRepoRuntimeHealth,
}: ChecksLoadingArgs): boolean =>
  !hasRuntimeCheck || !hasCachedBeadsCheck || !hasCachedRepoRuntimeHealth;
