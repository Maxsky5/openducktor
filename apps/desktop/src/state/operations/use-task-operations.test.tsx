import { describe, expect, mock, test } from "bun:test";
import type { BeadsCheck, RunSummary, TaskCard, TaskCreateInput } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { host } from "./host";
import { useTaskOperations } from "./use-task-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

const makeTask = (id: string, status: TaskCard["status"]): TaskCard => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status,
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
});

type HookArgs = Parameters<typeof useTaskOperations>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useTaskOperations> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useTaskOperations(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    updateArgs: async (nextArgs: HookArgs) => {
      currentArgs = nextArgs;
      await act(async () => {
        renderer?.update(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    run: async (fn: (value: ReturnType<typeof useTaskOperations>) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as ReturnType<typeof useTaskOperations>);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

describe("use-task-operations", () => {
  test("refreshTaskData filters deferred tasks and loads runs", async () => {
    const tasksList = mock(async () => [makeTask("A", "open"), makeTask("B", "deferred")]);
    const runsList = mock(
      async (): Promise<RunSummary[]> => [
        {
          runId: "run-1",
          runtimeKind: "opencode",
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:3000",
          },
          repoPath: "/repo",
          taskId: "A",
          branch: "feature/a",
          worktreePath: "/tmp/repo",
          port: 3000,
          state: "running",
          lastMessage: "working",
          startedAt: "2026-02-22T08:00:00.000Z",
        },
      ],
    );

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });

      expect(harness.getLatest().tasks.map((task) => task.id)).toEqual(["A"]);
      expect(harness.getLatest().runs).toHaveLength(1);
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("ignores stale refreshTaskData results after active repo switches", async () => {
    const deferredTasks = createDeferred<TaskCard[]>();
    const deferredRuns = createDeferred<RunSummary[]>();
    const tasksList = mock(async () => deferredTasks.promise);
    const runsList = mock(async () => deferredRuns.promise);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const refreshBeadsCheckForRepo = async (): Promise<BeadsCheck> => ({
      beadsOk: true,
      beadsPath: "/repo-a/.beads",
      beadsError: null,
    });
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      refreshBeadsCheckForRepo,
    });

    try {
      await harness.mount();

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshTaskData("/repo-a");
      });

      if (!refreshPromise) {
        throw new Error("refreshTaskData promise was not captured");
      }

      await harness.updateArgs({
        activeRepo: "/repo-b",
        refreshBeadsCheckForRepo,
      });

      deferredTasks.resolve([makeTask("A", "open")]);
      deferredRuns.resolve([
        {
          runId: "run-a",
          runtimeKind: "opencode",
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:3100",
          },
          repoPath: "/repo-a",
          taskId: "A",
          branch: "feature/a",
          worktreePath: "/tmp/repo-a",
          port: 3100,
          state: "running",
          lastMessage: null,
          startedAt: "2026-02-22T08:00:00.000Z",
        },
      ]);

      await refreshPromise;
      await flush();

      expect(harness.getLatest().tasks).toEqual([]);
      expect(harness.getLatest().runs).toEqual([]);
    } finally {
      deferredTasks.resolve([]);
      deferredRuns.resolve([]);
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("refreshTasks continues loading task data when pull request sync fails", async () => {
    const repoPullRequestSync = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(repoPullRequestSync).toHaveBeenCalledWith("/repo");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().tasks.map((task) => task.id)).toEqual(["A"]);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("createTask trims title before sending mutation", async () => {
    const taskCreate = mock(
      async (_repoPath: string, input: TaskCreateInput): Promise<TaskCard> => ({
        ...makeTask("A", "open"),
        title: input.title,
      }),
    );
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskCreate: host.taskCreate,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskCreate = taskCreate;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    const input: TaskCreateInput = {
      title: "  Ship feature  ",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
      labels: [],
      description: "",
      acceptanceCriteria: "",
    };

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.createTask(input);
      });

      expect(taskCreate).toHaveBeenCalledWith("/repo", {
        ...input,
        title: "Ship feature",
      });
      expect(tasksList).toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.taskCreate = original.taskCreate;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("createTask throws when no workspace is active even for blank title", async () => {
    const taskCreate = mock(
      async (_repoPath: string, input: TaskCreateInput): Promise<TaskCard> => ({
        ...makeTask("A", "open"),
        title: input.title,
      }),
    );

    const original = {
      taskCreate: host.taskCreate,
    };
    host.taskCreate = taskCreate;

    const harness = createHookHarness({
      activeRepo: null,
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: true,
        beadsPath: "/repo/.beads",
        beadsError: null,
      }),
    });

    try {
      await harness.mount();

      await expect(
        harness.run(async (value) => {
          await value.createTask({
            title: "   ",
            issueType: "task",
            aiReviewEnabled: true,
            priority: 2,
            labels: [],
            description: "",
            acceptanceCriteria: "",
          });
        }),
      ).rejects.toThrow("Select a workspace first.");

      expect(taskCreate).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.taskCreate = original.taskCreate;
    }
  });

  test("skips refresh when beads check reports unavailable", async () => {
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => ({
        beadsOk: false,
        beadsPath: null,
        beadsError: "missing store",
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });
});
