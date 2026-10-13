import { describe, expect, mock, test } from "bun:test";
import { CancelledError } from "@tanstack/react-query";
import {
  GitRefreshCoordinator,
  type GitRefreshSteps,
  type GitRefreshView,
  manualRefreshKey,
  SCHEDULED_FETCH_COOLDOWN_MS,
} from "./git-refresh-coordinator";

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

type Log = string[];

const createSteps = (log: Log, branchKey: string, overrides: Partial<GitRefreshSteps> = {}) => {
  const steps: GitRefreshSteps = {
    readBranch: mock(async () => {
      log.push("branch");
      return branchKey;
    }),
    comparison: {
      fetchKey: "origin/main",
      fetch: mock(async () => {
        log.push("fetch");
      }),
      check: mock(async () => {
        log.push("check");
        return false;
      }),
    },
    readLocal: mock(async () => {
      log.push("local");
    }),
    readComparison: mock(async (historyFailure: "reject" | "show") => {
      log.push(`comparison:${historyFailure}`);
    }),
    readInBackground: mock(async () => {
      log.push("background");
    }),
    ...overrides,
  };
  return steps;
};

const createView = (
  log: Log,
  overrides: Partial<Omit<GitRefreshView, "steps">> & {
    steps?: Partial<GitRefreshSteps>;
  } = {},
): GitRefreshView => {
  const { steps, ...view } = overrides;
  const branchKey = view.branchKey ?? "main";
  return {
    scopeKey: "session-a",
    branchKey,
    visible: true,
    ready: true,
    prepare: null,
    ...view,
    steps: createSteps(log, branchKey, steps),
  };
};

const createCoordinator = (now = () => 0) => {
  const failedChecks: string[] = [];
  const coordinator = new GitRefreshCoordinator({
    now,
    onFailedCheck: (message) => failedChecks.push(message),
  });
  return { coordinator, failedChecks };
};

describe("GitRefreshCoordinator", () => {
  test("a manual Refresh shows pending at once and joins repeated clicks", async () => {
    const log: Log = [];
    const fetch = deferred();
    const view = createView(log, {
      steps: {
        comparison: {
          fetchKey: "origin/main",
          fetch: () => fetch.promise,
          check: async () => false,
        },
      },
    });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    const first = coordinator.refresh("hard");
    const second = coordinator.refresh("hard");

    expect(second).toBe(first);
    expect(coordinator.manualState(manualRefreshKey(view))).toEqual({
      isRefreshing: true,
      error: null,
    });
    fetch.resolve();
    await first;
    expect(view.steps.readBranch).toHaveBeenCalledTimes(1);
    expect(coordinator.manualState(manualRefreshKey(view))).toEqual({
      isRefreshing: false,
      error: null,
    });
  });

  test("a manual Refresh reads local changes during the fetch and the comparison after it", async () => {
    const log: Log = [];
    const fetch = deferred();
    const view = createView(log, {
      steps: {
        comparison: {
          fetchKey: "origin/main",
          fetch: async () => {
            log.push("fetch");
            await fetch.promise;
          },
          check: async () => {
            log.push("check");
            return false;
          },
        },
      },
    });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    const refresh = coordinator.refresh("hard");
    await flush();
    expect(log).toEqual(["branch", "local", "fetch"]);
    fetch.resolve();
    await refresh;

    expect(log).toEqual(["branch", "local", "fetch", "check", "comparison:reject"]);
  });

  test("a manual Refresh keeps its failure until a later Refresh succeeds", async () => {
    const log: Log = [];
    const readLocal = mock(async (): Promise<void> => {
      throw new Error("status unavailable");
    });
    const view = createView(log, { steps: { readLocal } });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("hard");
    expect(coordinator.manualState(manualRefreshKey(view)).error).toBe("status unavailable");

    readLocal.mockImplementation(async () => {});
    await coordinator.refresh("hard");
    expect(coordinator.manualState(manualRefreshKey(view)).error).toBeNull();
  });

  test("each context keeps its own Refresh, and a return to a context joins it", async () => {
    const log: Log = [];
    const fetchA = deferred();
    const viewA = createView(log, {
      steps: {
        comparison: {
          fetchKey: "a",
          fetch: () => fetchA.promise,
          check: async () => false,
        },
      },
    });
    const viewB = createView(log, { scopeKey: "session-b" });
    const { coordinator } = createCoordinator();
    coordinator.publish(viewA);
    const refreshA = coordinator.refresh("hard");
    await flush();

    coordinator.publish(viewB);
    expect(coordinator.manualState(manualRefreshKey(viewB)).isRefreshing).toBe(false);
    coordinator.publish(viewA);
    expect(coordinator.refresh("hard")).toBe(refreshA);
    fetchA.resolve();
    await refreshA;
    expect(coordinator.manualState(manualRefreshKey(viewA)).isRefreshing).toBe(false);
  });

  test("a Refresh follows the branch that its own read found", async () => {
    const log: Log = [];
    const oldBranch = createView(log, {
      steps: { readBranch: async () => "feature" },
    });
    const newBranch = createView(log, { branchKey: "feature" });
    const { coordinator } = createCoordinator();
    coordinator.publish(oldBranch);

    const refresh = coordinator.refresh("hard");
    await flush();
    const newKey = manualRefreshKey(newBranch);
    expect(coordinator.manualState(manualRefreshKey(oldBranch)).isRefreshing).toBe(false);
    expect(coordinator.manualState(newKey).isRefreshing).toBe(true);
    expect(oldBranch.steps.readLocal).not.toHaveBeenCalled();

    coordinator.publish(newBranch);
    await refresh;
    expect(newBranch.steps.comparison?.fetch).toHaveBeenCalledTimes(1);
    expect(newBranch.steps.readComparison).toHaveBeenCalledWith("reject");
    expect(coordinator.manualState(newKey)).toEqual({
      isRefreshing: false,
      error: null,
    });
  });

  test("a followed branch ends without reads when another session opens", async () => {
    const log: Log = [];
    const oldBranch = createView(log, {
      steps: { readBranch: async () => "feature" },
    });
    const otherSession = createView(log, {
      scopeKey: "session-b",
      branchKey: "feature",
    });
    const { coordinator } = createCoordinator();
    coordinator.publish(oldBranch);

    const refresh = coordinator.refresh("hard");
    await flush();
    coordinator.publish(otherSession);
    await refresh;

    expect(otherSession.steps.comparison?.fetch).not.toHaveBeenCalled();
    expect(otherSession.steps.readLocal).not.toHaveBeenCalled();
  });

  test("a checkout that cancels the branch read ends the Refresh without a report", async () => {
    const log: Log = [];
    const view = createView(log, {
      steps: {
        readBranch: () => Promise.reject(new CancelledError({ revert: true })),
      },
    });
    const { coordinator, failedChecks } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("hard");

    expect(failedChecks).toEqual([]);
    expect(coordinator.manualState(manualRefreshKey(view)).error).toBeNull();
    expect(view.steps.readLocal).not.toHaveBeenCalled();
  });

  test("a failed branch read stays with its own session", async () => {
    const log: Log = [];
    const branchRead = deferred<string>();
    const view = createView(log, {
      steps: { readBranch: () => branchRead.promise },
    });
    const otherSession = createView(log, { scopeKey: "session-b" });
    const { coordinator, failedChecks } = createCoordinator();
    coordinator.publish(view);

    const refresh = coordinator.refresh("hard");
    coordinator.publish(otherSession);
    branchRead.reject(new Error("branch unavailable"));
    await refresh;

    expect(failedChecks).toEqual([]);
    expect(coordinator.manualState(manualRefreshKey(view)).error).toBe("branch unavailable");
    expect(coordinator.manualState(manualRefreshKey(otherSession)).error).toBeNull();
  });

  test("a manual Refresh loads failed settings, and continues in the next render", async () => {
    const log: Log = [];
    const prepare = mock(async () => {
      log.push("settings");
    });
    const failedSettings = createView(log, { prepare });
    const loadedSettings = createView(log);
    const { coordinator } = createCoordinator();
    coordinator.publish(failedSettings);

    const refresh = coordinator.refresh("hard");
    await flush();
    expect(log).toEqual(["settings"]);
    coordinator.publish(loadedSettings);
    await refresh;

    expect(failedSettings.steps.readBranch).not.toHaveBeenCalled();
    expect(loadedSettings.steps.comparison?.fetch).toHaveBeenCalledTimes(1);
    expect(loadedSettings.steps.readComparison).toHaveBeenCalledTimes(1);
  });

  test("a failed settings read reports its cause and still reads local changes", async () => {
    const log: Log = [];
    const view = createView(log, {
      prepare: async () => {
        throw new Error("settings unavailable");
      },
    });
    const { coordinator, failedChecks } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("hard");

    expect(failedChecks).toEqual(["settings unavailable"]);
    expect(log).toEqual(["local"]);
    expect(coordinator.manualState(manualRefreshKey(view)).error).toBe("settings unavailable");
  });

  test("a Refresh that starts before the checkout is known belongs to the first known checkout", async () => {
    const log: Log = [];
    const loading = createView(log, { branchKey: "unknown", ready: false });
    const loaded = createView(log, { branchKey: "main" });
    const { coordinator } = createCoordinator();
    coordinator.publish(loading);

    const refresh = coordinator.refresh("hard");
    expect(coordinator.manualState(manualRefreshKey(loading)).isRefreshing).toBe(true);
    coordinator.publish(loaded);
    expect(coordinator.manualState(manualRefreshKey(loaded)).isRefreshing).toBe(true);
    await refresh;

    expect(loading.steps.readBranch).not.toHaveBeenCalled();
    expect(loaded.steps.readComparison).toHaveBeenCalledWith("reject");
    expect(coordinator.manualState(manualRefreshKey(loaded)).isRefreshing).toBe(false);
  });

  test("a scheduled refresh ends when its view leaves, and a manual Refresh continues on return", async () => {
    const log: Log = [];
    const fetches = { scheduled: deferred(), manual: deferred() };
    const viewFor = (fetch: Promise<void>) =>
      createView(log, {
        steps: {
          comparison: {
            fetchKey: "origin/main",
            fetch: () => fetch,
            check: async () => false,
          },
        },
      });
    const scheduledView = viewFor(fetches.scheduled.promise);
    const otherSession = createView(log, { scopeKey: "session-b" });
    const { coordinator } = createCoordinator();
    coordinator.publish(scheduledView);
    const scheduled = coordinator.refresh("scheduled");
    await flush();
    coordinator.publish(otherSession);
    coordinator.publish(scheduledView);
    fetches.scheduled.resolve();
    await scheduled;
    expect(scheduledView.steps.readInBackground).not.toHaveBeenCalled();

    const manualView = viewFor(fetches.manual.promise);
    coordinator.publish(manualView);
    const manual = coordinator.refresh("hard");
    await flush();
    coordinator.publish(otherSession);
    coordinator.publish(manualView);
    fetches.manual.resolve();
    await manual;
    expect(manualView.steps.readComparison).toHaveBeenCalledWith("reject");
  });

  test("a changed target starts its own reads", async () => {
    const log: Log = [];
    const view = createView(log, {
      steps: {
        comparison: {
          fetchKey: "origin/main",
          fetch: async () => {},
          check: async () => true,
        },
      },
    });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("hard");

    expect(view.steps.readLocal).toHaveBeenCalledTimes(1);
    expect(view.steps.readComparison).not.toHaveBeenCalled();
  });

  test("a failed fetch reports its cause, reads once, and fails the Refresh", async () => {
    const log: Log = [];
    const view = createView(log, {
      steps: {
        comparison: {
          fetchKey: "origin/main",
          fetch: async () => {
            throw new Error("remote unavailable");
          },
          check: async () => false,
        },
      },
    });
    const { coordinator, failedChecks } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("hard");
    const softOutcome = await coordinator.refresh("soft").then(
      () => "resolved",
      (error: Error) => error.message,
    );

    expect(failedChecks).toEqual(["remote unavailable"]);
    expect(view.steps.readLocal).toHaveBeenCalledTimes(2);
    expect(view.steps.readComparison).toHaveBeenCalledTimes(2);
    expect(coordinator.manualState(manualRefreshKey(view)).error).toBe("remote unavailable");
    expect(softOutcome).toBe("resolved");
  });

  test("soft refreshes read without a fetch and leave History failures to History", async () => {
    const log: Log = [];
    const view = createView(log);
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("soft");

    expect(log).toEqual(["branch", "check", "local", "comparison:show"]);
  });

  test("a scheduled fetch waits for its cooldown, and a failed fetch can run again", async () => {
    const log: Log = [];
    let now = 0;
    const fetch = mock(async () => {
      log.push("fetch");
    });
    const view = createView(log, {
      steps: {
        comparison: {
          fetchKey: "origin/main",
          fetch,
          check: async () => false,
        },
      },
    });
    const { coordinator } = createCoordinator(() => now);
    coordinator.publish(view);

    await coordinator.refresh("scheduled");
    now = SCHEDULED_FETCH_COOLDOWN_MS - 1;
    await coordinator.refresh("scheduled");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(view.steps.readInBackground).toHaveBeenCalledTimes(2);

    now = SCHEDULED_FETCH_COOLDOWN_MS * 2;
    fetch.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await coordinator.refresh("scheduled").catch(() => undefined);
    await coordinator.refresh("scheduled");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("refreshes share a running fetch, and a fetch that outlives its view does not check", async () => {
    const log: Log = [];
    const fetch = deferred();
    const fetchStep = mock(() => fetch.promise);
    const check = mock(async () => false);
    const view = createView(log, {
      steps: {
        comparison: { fetchKey: "origin/main", fetch: fetchStep, check },
      },
    });
    const otherSession = createView(log, { scopeKey: "session-b" });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    const manual = coordinator.refresh("hard");
    const scheduled = coordinator.refresh("scheduled");
    await flush();
    coordinator.publish(otherSession);
    fetch.resolve();
    await Promise.all([manual, scheduled]);

    expect(fetchStep).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    expect(view.steps.readComparison).not.toHaveBeenCalled();
  });

  test("a hidden view reads no Git data, and its file views still read again", async () => {
    const log: Log = [];
    const view = createView(log, { visible: false });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);
    const withFiles = mock(async (_mode: string, readGit: () => Promise<void>) => {
      log.push("files");
      await readGit();
    });

    await coordinator.refresh("hard");
    await coordinator.refresh("soft", withFiles);

    expect(log).toEqual(["files"]);
  });

  test("the file refresh wraps the Git reads", async () => {
    const log: Log = [];
    const view = createView(log, {
      steps: { comparison: null },
    });
    const { coordinator } = createCoordinator();
    coordinator.publish(view);

    await coordinator.refresh("soft", async (mode, readGit) => {
      log.push(`files:${mode}`);
      await readGit();
      log.push("files done");
    });

    expect(log).toEqual(["files:soft", "branch", "local", "comparison:show", "files done"]);
  });
});
