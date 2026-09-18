const SWITCH_PERF_PREFIX = "[DEBUG-perf-switch]";

export const logSwitchPerf = (label: string, startedAt?: number): void => {
  const now = performance.now();
  const suffix = startedAt === undefined ? "" : ` in ${(now - startedAt).toFixed(0)}ms`;
  console.debug(`${SWITCH_PERF_PREFIX} ${now.toFixed(0)}ms ${label}${suffix}`);
};
