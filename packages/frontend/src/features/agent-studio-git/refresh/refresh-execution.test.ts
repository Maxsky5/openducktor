import { describe, expect, mock, test } from "bun:test";
import { mergeRefreshRequests, runDiffRefreshRequest } from "./refresh-execution";
import type { DiffRefreshContext, RefreshRequest } from "./refresh-types";

const createContext = (requestContextKey = "repo::main"): DiffRefreshContext => ({
  requestContextKey,
  repoPath: "/repo",
  targetBranch: "origin/main",
  workingDir: null,
  scope: "uncommitted",
});

const createRequest = (
  mode: RefreshRequest["mode"],
  context = createContext(),
): RefreshRequest => ({
  context,
  mode,
});

const createExecutionDeps = ({
  contextKey = "repo::main",
  nowMs = 1_731_000_000_000,
}: {
  contextKey?: string | null;
  nowMs?: number;
} = {}) => {
  let currentContextKey = contextKey;
  const scheduledFetchAtByContext = new Map<string, number>();
  const loadingStates: boolean[] = [];
  const refreshErrors: Array<string | null> = [];
  const fetchRemote = mock(async () => ({ outcome: "fetched" as const }));
  const invalidateRepoBranches = mock(async () => {});
  const refreshActiveScope = mock(async () => {});
  const refreshActiveScopeSummary = mock(async () => {});

  return {
    deps: {
      getCurrentRefreshContextKey: () => currentContextKey,
      setIsRefreshing: (_contextKey: string, isRefreshing: boolean) => {
        loadingStates.push(isRefreshing);
      },
      setRefreshError: (_contextKey: string, error: string | null) => {
        refreshErrors.push(error);
      },
      scheduledFetchAtByContext,
      nowMs: () => nowMs,
      fetchRemote,
      invalidateRepoBranches,
      refreshActiveScope,
      refreshActiveScopeSummary,
    },
    fetchRemote,
    invalidateRepoBranches,
    loadingStates,
    refreshActiveScope,
    refreshActiveScopeSummary,
    refreshErrors,
    scheduledFetchAtByContext,
    setContextKey: (nextContextKey: string | null) => {
      currentContextKey = nextContextKey;
    },
  };
};

describe("refresh execution", () => {
  test("mergeRefreshRequests keeps the highest priority request in the same context", () => {
    const context = createContext();

    expect(
      mergeRefreshRequests(createRequest("scheduled", context), createRequest("soft", context)),
    ).toEqual(createRequest("soft", context));
    expect(
      mergeRefreshRequests(createRequest("hard", context), createRequest("soft", context)),
    ).toEqual(createRequest("hard", context));
  });

  test("mergeRefreshRequests replaces queued work when the refresh context changes", () => {
    const previous = createRequest("hard", createContext("old"));
    const next = createRequest("soft", createContext("new"));

    expect(mergeRefreshRequests(previous, next)).toEqual(next);
  });

  test("hard refresh fetches remote, invalidates branches, and reloads the active scope", async () => {
    const harness = createExecutionDeps();

    const shouldContinue = await runDiffRefreshRequest(createRequest("hard"), harness.deps);

    expect(shouldContinue).toBe(true);
    expect(harness.fetchRemote).toHaveBeenCalledTimes(1);
    expect(harness.invalidateRepoBranches).toHaveBeenCalledWith("/repo");
    expect(harness.refreshActiveScope).toHaveBeenCalledWith(createContext());
    expect(harness.refreshActiveScopeSummary).not.toHaveBeenCalled();
    expect(harness.loadingStates).toEqual([true, false]);
    expect(harness.refreshErrors).toEqual([null]);
  });

  test("soft refresh skips remote fetch and reloads the active scope", async () => {
    const harness = createExecutionDeps();

    const shouldContinue = await runDiffRefreshRequest(createRequest("soft"), harness.deps);

    expect(shouldContinue).toBe(true);
    expect(harness.fetchRemote).not.toHaveBeenCalled();
    expect(harness.invalidateRepoBranches).not.toHaveBeenCalled();
    expect(harness.refreshActiveScope).toHaveBeenCalledWith(createContext());
    expect(harness.loadingStates).toEqual([true, false]);
    expect(harness.refreshErrors).toEqual([null]);
  });

  test("scheduled refresh records fetch failures and still refreshes the scope summary", async () => {
    const harness = createExecutionDeps();
    harness.fetchRemote.mockRejectedValueOnce(new Error("remote unavailable"));

    const shouldContinue = await runDiffRefreshRequest(createRequest("scheduled"), harness.deps);

    expect(shouldContinue).toBe(true);
    expect(harness.refreshErrors).toEqual(["Error: remote unavailable"]);
    expect(harness.refreshActiveScopeSummary).toHaveBeenCalledWith(createContext());
    expect(harness.loadingStates).toEqual([]);
  });

  test("scheduled refresh preserves fetch errors when summary refresh also fails", async () => {
    const harness = createExecutionDeps();
    harness.fetchRemote.mockRejectedValueOnce(new Error("remote unavailable"));
    harness.refreshActiveScopeSummary.mockRejectedValueOnce(new Error("summary unavailable"));

    const shouldContinue = await runDiffRefreshRequest(createRequest("scheduled"), harness.deps);

    expect(shouldContinue).toBe(true);
    expect(harness.refreshErrors).toEqual([
      "Error: remote unavailable",
      "Error: remote unavailable",
    ]);
    expect(harness.refreshActiveScopeSummary).toHaveBeenCalledWith(createContext());
  });

  test("scheduled refresh reports summary errors when fetch succeeds", async () => {
    const harness = createExecutionDeps();
    harness.refreshActiveScopeSummary.mockRejectedValueOnce(new Error("summary unavailable"));

    const shouldContinue = await runDiffRefreshRequest(createRequest("scheduled"), harness.deps);

    expect(shouldContinue).toBe(true);
    expect(harness.refreshErrors).toEqual([null, "Error: summary unavailable"]);
    expect(harness.refreshActiveScopeSummary).toHaveBeenCalledWith(createContext());
  });

  test("scheduled refresh skips remote fetch while cooldown is active", async () => {
    const harness = createExecutionDeps({ nowMs: 1_731_000_000_500 });
    harness.scheduledFetchAtByContext.set("/repo::origin/main::", 1_731_000_000_000);

    const shouldContinue = await runDiffRefreshRequest(createRequest("scheduled"), harness.deps);

    expect(shouldContinue).toBe(true);
    expect(harness.fetchRemote).not.toHaveBeenCalled();
    expect(harness.refreshErrors).toEqual([null]);
    expect(harness.refreshActiveScopeSummary).toHaveBeenCalledWith(createContext());
  });

  test("scheduled refresh stops before summary reload when context changes during fetch", async () => {
    const harness = createExecutionDeps();
    harness.fetchRemote.mockImplementationOnce(async () => {
      harness.setContextKey("next");
      return { outcome: "fetched" as const };
    });

    const shouldContinue = await runDiffRefreshRequest(createRequest("scheduled"), harness.deps);

    expect(shouldContinue).toBe(false);
    expect(harness.invalidateRepoBranches).not.toHaveBeenCalled();
    expect(harness.refreshErrors).toEqual([]);
    expect(harness.refreshActiveScopeSummary).not.toHaveBeenCalled();
  });

  test("stale refresh contexts stop before mutating query or scope state", async () => {
    const harness = createExecutionDeps();
    harness.fetchRemote.mockImplementationOnce(async () => {
      harness.setContextKey("next");
      return { outcome: "fetched" as const };
    });

    const shouldContinue = await runDiffRefreshRequest(createRequest("hard"), harness.deps);

    expect(shouldContinue).toBe(false);
    expect(harness.invalidateRepoBranches).not.toHaveBeenCalled();
    expect(harness.refreshActiveScope).not.toHaveBeenCalled();
    expect(harness.scheduledFetchAtByContext.size).toBe(0);
    expect(harness.loadingStates).toEqual([true]);
  });
});
