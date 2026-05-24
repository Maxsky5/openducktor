import type { DiffRefreshContext } from "./refresh-types";

export const SCHEDULED_FETCH_COOLDOWN_MS = 5 * 60 * 1000;

export const createScheduledFetchCooldownKey = ({
  repoPath,
  targetBranch,
  workingDir,
}: Pick<DiffRefreshContext, "repoPath" | "targetBranch" | "workingDir">): string =>
  `${repoPath}::${targetBranch}::${workingDir ?? ""}`;

export const shouldRunScheduledFetch = ({
  lastFetchedAtMs,
  nowMs,
}: {
  lastFetchedAtMs: number | null;
  nowMs: number;
}): boolean => lastFetchedAtMs == null || nowMs - lastFetchedAtMs >= SCHEDULED_FETCH_COOLDOWN_MS;
