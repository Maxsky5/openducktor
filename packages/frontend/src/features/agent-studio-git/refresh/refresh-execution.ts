import type { GitDiffRefreshMode } from "../contracts";
import { createScheduledFetchCooldownKey, shouldRunScheduledFetch } from "./polling-policy";
import type { DiffRefreshContext, RefreshRequest, RefreshScopeContext } from "./refresh-types";

type FetchRemoteResult = {
  outcome: "fetched" | "skipped_no_remote";
};

type RunDiffRefreshRequestDeps = {
  getCurrentRefreshContextKey: () => string | null;
  setIsRefreshing: (isRefreshing: boolean) => void;
  setRefreshError: (error: string | null) => void;
  scheduledFetchAtByContext: Map<string, number>;
  nowMs: () => number;
  fetchRemote: (context: DiffRefreshContext) => Promise<FetchRemoteResult>;
  invalidateRepoBranches: (repoPath: string) => Promise<void>;
  refreshActiveScope: (context: RefreshScopeContext) => Promise<void>;
  refreshActiveScopeSummary: (context: RefreshScopeContext) => Promise<void>;
};

const refreshModePriority = (mode: GitDiffRefreshMode): number => {
  switch (mode) {
    case "hard":
      return 3;
    case "soft":
      return 2;
    case "scheduled":
      return 1;
  }
};

export const mergeRefreshRequests = (
  current: RefreshRequest | null,
  next: RefreshRequest,
): RefreshRequest => {
  if (current == null || current.context.requestContextKey !== next.context.requestContextKey) {
    return next;
  }

  return refreshModePriority(next.mode) > refreshModePriority(current.mode) ? next : current;
};

const hasSameRefreshContext = (
  context: DiffRefreshContext,
  deps: Pick<RunDiffRefreshRequestDeps, "getCurrentRefreshContextKey">,
): boolean => deps.getCurrentRefreshContextKey() === context.requestContextKey;

const updateScheduledFetchCooldown = (
  context: DiffRefreshContext,
  deps: Pick<RunDiffRefreshRequestDeps, "nowMs" | "scheduledFetchAtByContext">,
): void => {
  deps.scheduledFetchAtByContext.set(createScheduledFetchCooldownKey(context), deps.nowMs());
};

const canRunScheduledFetch = (
  context: DiffRefreshContext,
  deps: Pick<RunDiffRefreshRequestDeps, "nowMs" | "scheduledFetchAtByContext">,
): boolean => {
  const lastFetchedAt = deps.scheduledFetchAtByContext.get(
    createScheduledFetchCooldownKey(context),
  );
  return shouldRunScheduledFetch({
    lastFetchedAtMs: lastFetchedAt ?? null,
    nowMs: deps.nowMs(),
  });
};

const fetchRemoteForRefresh = async (
  context: DiffRefreshContext,
  deps: Pick<
    RunDiffRefreshRequestDeps,
    | "fetchRemote"
    | "getCurrentRefreshContextKey"
    | "invalidateRepoBranches"
    | "nowMs"
    | "scheduledFetchAtByContext"
  >,
): Promise<boolean> => {
  if (!hasSameRefreshContext(context, deps)) {
    return false;
  }

  const fetchResult = await deps.fetchRemote(context);
  if (hasSameRefreshContext(context, deps) && fetchResult.outcome === "fetched") {
    await deps.invalidateRepoBranches(context.repoPath);
  }

  if (!hasSameRefreshContext(context, deps)) {
    return false;
  }

  updateScheduledFetchCooldown(context, deps);
  return true;
};

export const runDiffRefreshRequest = async (
  request: RefreshRequest,
  deps: RunDiffRefreshRequestDeps,
): Promise<boolean> => {
  const context = request.context;
  const showLoading = request.mode !== "scheduled";

  if (!hasSameRefreshContext(context, deps)) {
    return false;
  }

  if (showLoading) {
    deps.setIsRefreshing(true);
  }

  try {
    if (request.mode === "hard") {
      const fetchCompleted = await fetchRemoteForRefresh(context, deps);
      if (!fetchCompleted) {
        return false;
      }

      deps.setRefreshError(null);
      await deps.refreshActiveScope(context);
      return true;
    }

    if (request.mode === "soft") {
      deps.setRefreshError(null);
      await deps.refreshActiveScope(context);
      return true;
    }

    let scheduledFetchError: string | null = null;
    if (canRunScheduledFetch(context, deps)) {
      try {
        const fetchCompleted = await fetchRemoteForRefresh(context, deps);
        if (!fetchCompleted) {
          return false;
        }
      } catch (error) {
        if (hasSameRefreshContext(context, deps)) {
          scheduledFetchError = String(error);
        }
      }
    }

    if (hasSameRefreshContext(context, deps)) {
      deps.setRefreshError(scheduledFetchError);
    }
    await deps.refreshActiveScopeSummary(context);
    return true;
  } catch (error) {
    if (hasSameRefreshContext(context, deps)) {
      deps.setRefreshError(String(error));
    }
    return true;
  } finally {
    if (showLoading && hasSameRefreshContext(context, deps)) {
      deps.setIsRefreshing(false);
    }
  }
};
