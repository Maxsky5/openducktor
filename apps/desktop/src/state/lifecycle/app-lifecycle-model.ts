import type { RunEvent } from "@openducktor/contracts";

type ChecksLoadingArgs = {
  hasRuntimeCheck: boolean;
  hasCachedBeadsCheck: boolean;
  hasCachedRepoRuntimeHealth: boolean;
};

export const MAX_RUN_EVENTS = 500;

export const prependRunEvent = (current: RunEvent[], next: RunEvent): RunEvent[] =>
  [next, ...current].slice(0, MAX_RUN_EVENTS);

export const shouldLoadChecks = ({
  hasRuntimeCheck,
  hasCachedBeadsCheck,
  hasCachedRepoRuntimeHealth,
}: ChecksLoadingArgs): boolean =>
  !hasRuntimeCheck || !hasCachedBeadsCheck || !hasCachedRepoRuntimeHealth;
