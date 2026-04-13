import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { BeadsCheck, RunSummary, TaskCard, TaskCreateInput } from "@openducktor/contracts";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { toast } from "sonner";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { isKanbanForegroundLoading } from "@/pages/kanban/use-kanban-page-models";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  type BeadsCheckFixtureOverrides,
  createBeadsCheckFixture as createSharedBeadsCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { documentQueryKeys } from "../../queries/documents";
import { kanbanTaskListQueryOptions, taskQueryKeys } from "../../queries/tasks";
import {
  attachAgentSessionListener,
  type SessionEventAdapter,
} from "../agent-orchestrator/events/session-events";
import { host } from "../shared/host";
import { useTaskOperations } from "./use-task-operations";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_REFRESH_WARNING = "Pull request sync failed during task refresh";
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalToastSuccess = toast.success;

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

const buildAgentSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "A",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4321" },
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const makeBeadsCheck = (overrides: BeadsCheckFixtureOverrides = {}): BeadsCheck =>
  createSharedBeadsCheckFixture({}, overrides);

type HookArgs = Parameters<typeof useTaskOperations>[0];

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: ReturnType<typeof useTaskOperations> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useTaskOperations(args);
    return null;
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryProvider useIsolatedClient>{children}</QueryProvider>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    updateArgs: async (nextArgs: HookArgs) => {
      currentArgs = nextArgs;
      await sharedHarness.update({ args: currentArgs });
    },
    run: async (fn: (value: ReturnType<typeof useTaskOperations>) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(latest as ReturnType<typeof useTaskOperations>);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    waitFor: async (
      predicate: (value: ReturnType<typeof useTaskOperations>) => boolean,
      timeoutMs?: number,
    ) => {
      await sharedHarness.waitFor(() => latest !== null && predicate(latest), timeoutMs);
    },
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

type TaskAndKanbanHarnessState = {
  operations: ReturnType<typeof useTaskOperations>;
  kanbanTasks: TaskCard[];
  isPendingKanban: boolean;
  isFetchingKanban: boolean;
};

type ScheduledKanbanRefetchScenario = {
  initialTasks: TaskCard[];
  expectedVisibleTaskId: string | undefined;
};

const createTaskAndKanbanHarness = (initialArgs: HookArgs, doneVisibleDays = 1) => {
  let latest: TaskAndKanbanHarnessState | null = null;
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    const operations = useTaskOperations(args);
    const kanbanTaskListQuery = useQuery({
      ...kanbanTaskListQueryOptions(args.activeRepo ?? "__disabled__", doneVisibleDays),
      enabled: args.activeRepo !== null,
    });

    latest = {
      operations,
      kanbanTasks: args.activeRepo ? (kanbanTaskListQuery.data ?? []) : [],
      isPendingKanban: args.activeRepo !== null && kanbanTaskListQuery.isPending,
      isFetchingKanban:
        args.activeRepo !== null &&
        (kanbanTaskListQuery.isPending || kanbanTaskListQuery.isFetching),
    };

    return null;
  };

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryProvider useIsolatedClient>{children}</QueryProvider>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    run: async (fn: (value: TaskAndKanbanHarnessState) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await sharedHarness.run(async () => {
        await fn(latest as TaskAndKanbanHarnessState);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      return latest;
    },
    waitFor: async (
      predicate: (value: TaskAndKanbanHarnessState) => boolean,
      timeoutMs?: number,
    ) => {
      await sharedHarness.waitFor(() => latest !== null && predicate(latest), timeoutMs);
    },
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

const assertScheduledKanbanRefetchStaysBackground = async ({
  initialTasks,
  expectedVisibleTaskId,
}: ScheduledKanbanRefetchScenario): Promise<void> => {
  const repoPullRequestSyncDeferred = createDeferred<{ ok: boolean }>();
  let repoTaskListCallCount = 0;
  let kanbanTaskListCallCount = 0;
  let runsListCallCount = 0;
  const repoTaskRefreshDeferred = createDeferred<TaskCard[]>();
  const kanbanRefreshDeferred = createDeferred<TaskCard[]>();
  const runsRefreshDeferred = createDeferred<RunSummary[]>();
  const repoPullRequestSync = mock(async () => repoPullRequestSyncDeferred.promise);
  const tasksList = mock(async (_repoPath: string, doneVisibleDays?: number) => {
    if (typeof doneVisibleDays === "number") {
      kanbanTaskListCallCount += 1;
      return kanbanTaskListCallCount === 1 ? initialTasks : kanbanRefreshDeferred.promise;
    }

    repoTaskListCallCount += 1;
    return repoTaskListCallCount === 1 ? initialTasks : repoTaskRefreshDeferred.promise;
  });
  const runsList = mock(async (): Promise<RunSummary[]> => {
    runsListCallCount += 1;
    return runsListCallCount === 1 ? [] : runsRefreshDeferred.promise;
  });

  const original = {
    repoPullRequestSync: host.repoPullRequestSync,
    tasksList: host.tasksList,
    runsList: host.runsList,
  };
  host.repoPullRequestSync = repoPullRequestSync;
  host.tasksList = tasksList;
  host.runsList = runsList;

  const harness = createTaskAndKanbanHarness({
    activeRepo: "/repo",
    refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
  });

  try {
    await harness.mount();
    await harness.waitFor(
      (value) =>
        !value.isPendingKanban &&
        !value.isFetchingKanban &&
        value.kanbanTasks[0]?.id === expectedVisibleTaskId &&
        value.kanbanTasks.length === initialTasks.length,
      1000,
    );

    let scheduledRefreshPromise: Promise<void> | null = null;
    await harness.run((value) => {
      scheduledRefreshPromise = value.operations.refreshTasksWithOptions({ trigger: "scheduled" });
    });

    await harness.run(async () => {
      repoPullRequestSyncDeferred.resolve({ ok: true });
    });
    await harness.waitFor(
      (value) => !value.isPendingKanban && value.isFetchingKanban && kanbanTaskListCallCount >= 2,
      1000,
    );

    if (!scheduledRefreshPromise) {
      throw new Error("Expected scheduled refresh promise to be created");
    }

    const latest = harness.getLatest();
    const foregroundLoading = isKanbanForegroundLoading({
      hasActiveRepo: true,
      isForegroundLoadingTasks: latest.operations.isForegroundLoadingTasks,
      isSettingsPending: false,
      doneVisibleDays: 1,
      isKanbanPending: latest.isPendingKanban,
    });

    expect(repoTaskListCallCount).toBeGreaterThanOrEqual(2);
    expect(latest.operations.isForegroundLoadingTasks).toBe(false);
    expect(latest.operations.isRefreshingTasksInBackground).toBe(true);
    expect(foregroundLoading).toBe(false);
    expect(foregroundLoading && latest.kanbanTasks.length === 0).toBe(false);
    expect(latest.kanbanTasks[0]?.id).toBe(expectedVisibleTaskId);

    await harness.run(async () => {
      repoTaskRefreshDeferred.resolve(initialTasks);
      kanbanRefreshDeferred.resolve(initialTasks);
      runsRefreshDeferred.resolve([]);
      await scheduledRefreshPromise;
    });

    await harness.waitFor(
      (value) => !value.operations.isRefreshingTasksInBackground && !value.isFetchingKanban,
      1000,
    );
  } finally {
    repoPullRequestSyncDeferred.resolve({ ok: true });
    repoTaskRefreshDeferred.resolve(initialTasks);
    kanbanRefreshDeferred.resolve(initialTasks);
    runsRefreshDeferred.resolve([]);
    await harness.unmount();
    host.repoPullRequestSync = original.repoPullRequestSync;
    host.tasksList = original.tasksList;
    host.runsList = original.runsList;
  }
};

describe("use-task-operations", () => {
  beforeEach(async () => {
    console.error = (...args: Parameters<typeof console.error>): void => {
      const [firstArg] = args;
      if (typeof firstArg === "string" && firstArg.startsWith(TASK_REFRESH_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };
    console.warn = (...args: Parameters<typeof console.warn>): void => {
      const [firstArg] = args;
      if (typeof firstArg === "string" && firstArg.startsWith(TASK_REFRESH_WARNING)) {
        return;
      }
      originalConsoleWarn(...args);
    };
    (toast as { success: typeof toast.success }).success = mock(
      (_message: string, _options?: { description?: string }) => "",
    ) as unknown as typeof toast.success;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    toast.success = originalToastSuccess;
  });

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
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> =>
        makeBeadsCheck({
          beadsOk: false,
          beadsPath: null,
          beadsError: "missing store",
          repoStoreHealth: {
            category: "attachment_verification_failed",
            status: "blocking",
            isReady: false,
            detail: "missing store",
          },
        }),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.status === "open");
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });
      await harness.waitFor((value) => value.tasks.map((task) => task.id).join(",") === "A");

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

  test("refreshTaskData bypasses stale cached task data on repeated explicit refreshes", async () => {
    let taskLoadCount = 0;
    const tasksList = mock(async () => {
      taskLoadCount += 1;
      return [makeTask("A", taskLoadCount >= 3 ? "ready_for_dev" : "open")];
    });
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> =>
        makeBeadsCheck({
          beadsOk: false,
          beadsPath: "/repo/.beads",
          beadsError: "beads unavailable",
          repoStoreHealth: {
            category: "shared_server_unavailable",
            status: "blocking",
            isReady: false,
            detail: "beads unavailable",
          },
        }),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });
      await harness.waitFor((value) => value.tasks[0]?.status === "open");
      expect(harness.getLatest().tasks[0]?.status).toBe("open");

      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });
      await harness.waitFor((value) => value.tasks[0]?.status === "ready_for_dev");

      expect(tasksList).toHaveBeenCalledTimes(3);
      expect(runsList).toHaveBeenCalledTimes(3);
      expect(harness.getLatest().tasks[0]?.status).toBe("ready_for_dev");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("resetTaskImplementation refreshes task data after host reset completes", async () => {
    let currentStatus: TaskCard["status"] = "in_progress";
    const taskResetImplementation = mock(async () => {
      currentStatus = "ready_for_dev";
      return makeTask("A", "ready_for_dev");
    });
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskResetImplementation: host.taskResetImplementation,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskResetImplementation = taskResetImplementation;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.status === "in_progress");
      expect(harness.getLatest().tasks[0]?.status).toBe("in_progress");

      await harness.run(async (value) => {
        await value.resetTaskImplementation("A");
      });
      await harness.waitFor((value) => value.tasks[0]?.status === "ready_for_dev");

      expect(taskResetImplementation).toHaveBeenCalledWith("/repo", "A");
      expect(harness.getLatest().tasks[0]?.status).toBe("ready_for_dev");
    } finally {
      await harness.unmount();
      host.taskResetImplementation = original.taskResetImplementation;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("resetTaskImplementation surfaces a toast and rethrows when reset fails", async () => {
    const taskResetImplementation = mock(async () => {
      throw new Error("reset failed");
    });
    const toastError = mock(() => {});

    const original = {
      taskResetImplementation: host.taskResetImplementation,
      toastError: toast.error,
    };
    host.taskResetImplementation = taskResetImplementation;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await expect(
        harness.run(async (value) => {
          await value.resetTaskImplementation("A");
        }),
      ).rejects.toThrow("reset failed");
      expect(toastError).toHaveBeenCalledWith("Failed to reset implementation", {
        description: "reset failed",
      });
    } finally {
      await harness.unmount();
      host.taskResetImplementation = original.taskResetImplementation;
      toast.error = original.toastError;
    }
  });

  test("resetTask refreshes task data after host reset completes", async () => {
    let currentStatus: TaskCard["status"] = "human_review";
    const taskReset = mock(async () => {
      currentStatus = "open";
      return makeTask("A", "open");
    });
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskReset: host.taskReset,
      tasksList: host.tasksList,
      runsList: host.runsList,
      taskDocumentGet: host.taskDocumentGet,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.taskReset = taskReset;
    host.tasksList = tasksList;
    host.runsList = runsList;
    host.taskDocumentGet = (async () => ({
      markdown: "",
      updatedAt: null,
    })) as typeof host.taskDocumentGet;
    host.taskDocumentGetFresh = (async () => ({
      markdown: "",
      updatedAt: null,
    })) as typeof host.taskDocumentGetFresh;

    const queryClient = createQueryClient();
    const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
    const invalidateQueriesMock = mock(
      (filters: Parameters<typeof queryClient.invalidateQueries>[0]) =>
        originalInvalidateQueries(filters),
    );
    queryClient.invalidateQueries = invalidateQueriesMock as typeof queryClient.invalidateQueries;
    let latest: ReturnType<typeof useTaskOperations> | null = null;
    const getLatest = () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(args);
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeRepo: "/repo",
          refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(documentQueryKeys.spec("/repo", "A"), {
        markdown: "# Spec",
        updatedAt: "2026-03-28T00:00:00.000Z",
      });
      queryClient.setQueryData(documentQueryKeys.plan("/repo", "A"), {
        markdown: "# Plan",
        updatedAt: "2026-03-28T00:00:00.000Z",
      });
      queryClient.setQueryData(documentQueryKeys.qaReport("/repo", "A"), {
        markdown: "# QA",
        updatedAt: "2026-03-28T00:00:00.000Z",
      });
      queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "A"), [buildAgentSession()]);

      await harness.mount();
      await harness.waitFor(() => getLatest().tasks[0]?.status === "human_review");

      await harness.run(async () => {
        await getLatest().resetTask("A");
      });
      await harness.waitFor(() => getLatest().tasks[0]?.status === "open");

      expect(taskReset).toHaveBeenCalledWith("/repo", "A");
      expect(getLatest().tasks[0]?.status).toBe("open");
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: agentSessionQueryKeys.list("/repo", "A"),
        exact: true,
        refetchType: "none",
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: documentQueryKeys.qaReport("/repo", "A"),
        exact: true,
        refetchType: "none",
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: documentQueryKeys.spec("/repo", "A"),
        exact: true,
        refetchType: "none",
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: documentQueryKeys.plan("/repo", "A"),
        exact: true,
        refetchType: "none",
      });
    } finally {
      await harness.unmount();
      host.taskReset = original.taskReset;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      host.taskDocumentGet = original.taskDocumentGet;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
    }
  });

  test("resetTask surfaces a toast and rethrows when reset fails", async () => {
    const taskReset = mock(async () => {
      throw new Error("reset task failed");
    });
    const toastError = mock(() => {});

    const original = {
      taskReset: host.taskReset,
      toastError: toast.error,
    };
    host.taskReset = taskReset;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await expect(
        harness.run(async (value) => {
          await value.resetTask("A");
        }),
      ).rejects.toThrow("reset task failed");
      expect(toastError).toHaveBeenCalledWith("Failed to reset task", {
        description: "reset task failed",
      });
    } finally {
      await harness.unmount();
      host.taskReset = original.taskReset;
      toast.error = original.toastError;
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

    const refreshBeadsCheckForRepo = async (): Promise<BeadsCheck> => makeBeadsCheck();
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

  test("refreshTasks stops before task data refresh when pull request sync fails", async () => {
    const repoPullRequestSync = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
      toastError: toast.error,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      tasksList.mockClear();
      runsList.mockClear();

      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(repoPullRequestSync).toHaveBeenCalledWith("/repo");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "Task store unavailable. gh auth expired",
      });
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("refreshTasks refreshes Beads diagnostics again after successful task loading", async () => {
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const refreshBeadsCheckForRepo = mock(
      async (_repoPath: string, force = false): Promise<BeadsCheck> =>
        force
          ? makeBeadsCheck({ beadsPath: null })
          : makeBeadsCheck({
              beadsOk: false,
              beadsPath: "/repo/.beads",
              beadsError:
                "error on line 1 for query show databases: dial tcp 127.0.0.1:38240: connect: connection refused",
              repoStoreHealth: {
                category: "shared_server_unavailable",
                status: "blocking",
                isReady: false,
                detail:
                  "error on line 1 for query show databases: dial tcp 127.0.0.1:38240: connect: connection refused",
                attachment: {
                  path: "/repo/.beads",
                  databaseName: "repo_db",
                },
                sharedServer: {
                  host: "127.0.0.1",
                  port: 38240,
                  ownershipState: "unavailable",
                },
              },
            }),
    );

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
      refreshBeadsCheckForRepo,
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      refreshBeadsCheckForRepo.mockClear();

      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(refreshBeadsCheckForRepo).toHaveBeenNthCalledWith(1, "/repo", false);
      expect(refreshBeadsCheckForRepo).toHaveBeenNthCalledWith(2, "/repo", true);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("scheduled and manual refresh join the same in-flight repo sync", async () => {
    const repoPullRequestSyncDeferred = createDeferred<{ ok: boolean }>();
    const repoPullRequestSync = mock(async () => repoPullRequestSyncDeferred.promise);
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
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      tasksList.mockClear();
      runsList.mockClear();

      let scheduledRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        scheduledRefreshPromise = value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(repoPullRequestSync).toHaveBeenCalledTimes(1);

      let manualRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        manualRefreshPromise = value.refreshTasks();
      });
      await harness.waitFor((value) => value.isLoadingTasks);

      expect(repoPullRequestSync).toHaveBeenCalledTimes(1);

      if (!scheduledRefreshPromise || !manualRefreshPromise) {
        throw new Error("Expected both refresh promises to be created");
      }

      await harness.run(async () => {
        repoPullRequestSyncDeferred.resolve({ ok: true });
        await Promise.all([scheduledRefreshPromise, manualRefreshPromise]);
      });
      await harness.waitFor((value) => !value.isLoadingTasks);

      expect(tasksList).toHaveBeenCalledTimes(1);
      expect(runsList).toHaveBeenCalledTimes(1);
    } finally {
      repoPullRequestSyncDeferred.resolve({ ok: true });
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("scheduled and manual refresh share one toast when the joined repo sync fails", async () => {
    const repoPullRequestSyncDeferred = createDeferred<{ ok: boolean }>();
    const repoPullRequestSync = mock(async () => repoPullRequestSyncDeferred.promise);
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    const consoleWarn = mock(() => {});

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
      toastError: toast.error,
      consoleWarn: console.warn,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;
    console.warn = consoleWarn as unknown as typeof console.warn;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      let scheduledRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        scheduledRefreshPromise = value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      let manualRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        manualRefreshPromise = value.refreshTasks();
      });
      await harness.waitFor((value) => value.isLoadingTasks);

      if (!scheduledRefreshPromise || !manualRefreshPromise) {
        throw new Error("Expected both refresh promises to be created");
      }

      await harness.run(async () => {
        repoPullRequestSyncDeferred.reject(new Error("gh auth expired"));
        await Promise.all([scheduledRefreshPromise, manualRefreshPromise]);
      });
      await harness.waitFor((value) => !value.isLoadingTasks);

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "Task store unavailable. gh auth expired",
      });
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(TASK_REFRESH_WARNING, {
        repoPath: "/repo",
        trigger: "scheduled",
        description: "Task store unavailable. gh auth expired",
        error: "gh auth expired",
      });
    } finally {
      repoPullRequestSyncDeferred.resolve({ ok: true });
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = original.toastError;
      console.warn = original.consoleWarn;
    }
  });

  test("refreshTasks preserves the thrown error when a later step fails", async () => {
    const repoPullRequestSync = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    const consoleWarn = mock(() => {});

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
      toastError: toast.error,
      consoleWarn: console.warn,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;
    console.warn = consoleWarn as unknown as typeof console.warn;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> =>
        makeBeadsCheck({
          beadsOk: false,
          beadsPath: "/repo/.beads",
          beadsError: "Shared Dolt database repo_db is missing and restore is required",
          repoStoreHealth: {
            category: "missing_shared_database",
            status: "restore_needed",
            isReady: false,
            detail: "Shared Dolt database repo_db is missing and restore is required",
            attachment: {
              path: "/repo/.beads",
              databaseName: "repo_db",
            },
          },
        }),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      toastError.mockClear();
      consoleWarn.mockClear();

      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "Task store unavailable. gh auth expired",
      });
      expect(consoleWarn).toHaveBeenCalledWith(TASK_REFRESH_WARNING, {
        repoPath: "/repo",
        trigger: "manual",
        description: "Task store unavailable. gh auth expired",
        error: "gh auth expired",
      });
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = original.toastError;
      console.warn = original.consoleWarn;
    }
  });

  test("an earlier manual refresh cannot clear a later repo refresh loading state", async () => {
    const repoARefreshDeferred = createDeferred<{ ok: boolean }>();
    const repoBRefreshDeferred = createDeferred<{ ok: boolean }>();
    const repoPullRequestSync = mock(async (repoPath: string) => {
      if (repoPath === "/repo-a") {
        return repoARefreshDeferred.promise;
      }

      if (repoPath === "/repo-b") {
        return repoBRefreshDeferred.promise;
      }

      throw new Error(`Unexpected repo path ${repoPath}`);
    });
    const tasksList = mock(async (repoPath: string) => {
      if (repoPath === "/repo-a") {
        return [makeTask("A", "open")];
      }

      return [makeTask("B", "open")];
    });
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
      activeRepo: "/repo-a",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      let repoAManualRefresh: Promise<void> | null = null;
      await harness.run((value) => {
        repoAManualRefresh = value.refreshTasks();
      });
      await harness.waitFor((value) => value.isLoadingTasks);

      await harness.updateArgs({
        activeRepo: "/repo-b",
        refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
      });
      await harness.waitFor((value) => value.tasks[0]?.id === "B");
      await harness.waitFor((value) => !value.isLoadingTasks);

      let repoBManualRefresh: Promise<void> | null = null;
      await harness.run((value) => {
        repoBManualRefresh = value.refreshTasks();
      });
      await harness.waitFor((value) => value.isLoadingTasks);

      if (!repoAManualRefresh || !repoBManualRefresh) {
        throw new Error("Expected both manual refresh promises to be created");
      }

      await harness.run(async () => {
        repoARefreshDeferred.resolve({ ok: true });
        await repoAManualRefresh;
      });

      expect(harness.getLatest().isLoadingTasks).toBe(true);

      await harness.run(async () => {
        repoBRefreshDeferred.resolve({ ok: true });
        await repoBManualRefresh;
      });
      await harness.waitFor((value) => !value.isLoadingTasks);
    } finally {
      repoARefreshDeferred.resolve({ ok: true });
      repoBRefreshDeferred.resolve({ ok: true });
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("scheduled refresh keeps task loading state in background while repo data refetch is in flight", async () => {
    const repoPullRequestSyncDeferred = createDeferred<{ ok: boolean }>();
    const repoPullRequestSync = mock(async () => repoPullRequestSyncDeferred.promise);
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
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      tasksList.mockClear();
      runsList.mockClear();

      let scheduledRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        scheduledRefreshPromise = value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(harness.getLatest().isLoadingTasks).toBe(false);
      expect(repoPullRequestSync).toHaveBeenCalledTimes(1);

      if (!scheduledRefreshPromise) {
        throw new Error("Expected scheduled refresh promise to be created");
      }

      await harness.run(async () => {
        repoPullRequestSyncDeferred.resolve({ ok: true });
        await scheduledRefreshPromise;
      });

      expect(harness.getLatest().isLoadingTasks).toBe(false);
      expect(tasksList).toHaveBeenCalledTimes(1);
      expect(runsList).toHaveBeenCalledTimes(1);
    } finally {
      repoPullRequestSyncDeferred.resolve({ ok: true });
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("scheduled refresh keeps an empty kanban board out of foreground loading during post-sync refetch", async () => {
    await assertScheduledKanbanRefetchStaysBackground({
      initialTasks: [],
      expectedVisibleTaskId: undefined,
    });
  });

  test("scheduled refresh keeps visible kanban tasks out of foreground loading during post-sync refetch", async () => {
    await assertScheduledKanbanRefetchStaysBackground({
      initialTasks: [makeTask("A", "open")],
      expectedVisibleTaskId: "A",
    });
  });

  test("scheduled refresh dedupes repeated identical failures and resets after success", async () => {
    let shouldFailPullRequestSync = true;
    const repoPullRequestSync = mock(async () => {
      if (shouldFailPullRequestSync) {
        throw new Error("gh auth expired");
      }

      return { ok: true };
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    const consoleWarn = mock(() => {});

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
      toastError: toast.error,
      consoleWarn: console.warn,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;
    console.warn = consoleWarn as unknown as typeof console.warn;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      toastError.mockClear();

      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });
      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "Task store unavailable. gh auth expired",
      });
      expect(consoleWarn).toHaveBeenCalledTimes(2);

      shouldFailPullRequestSync = false;
      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      shouldFailPullRequestSync = true;
      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(toastError).toHaveBeenCalledTimes(2);
      expect(consoleWarn).toHaveBeenCalledTimes(3);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = original.toastError;
      console.warn = original.consoleWarn;
    }
  });

  test("refreshTasks updates an active kanban query after backend task status changes", async () => {
    let currentStatus: TaskCard["status"] = "human_review";
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          !value.isFetchingKanban &&
          value.operations.tasks[0]?.status === "human_review" &&
          value.kanbanTasks[0]?.status === "human_review",
      );
      tasksList.mockClear();
      runsList.mockClear();

      currentStatus = "closed";

      await harness.run(async (value) => {
        await value.operations.refreshTasks();
      });
      await harness.waitFor(
        (value) =>
          !value.isFetchingKanban &&
          value.operations.tasks[0]?.status === "closed" &&
          value.kanbanTasks[0]?.status === "closed",
      );

      expect(repoPullRequestSync).toHaveBeenCalledWith("/repo");
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args.length === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(runsList).toHaveBeenCalledWith("/repo");
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("refreshTaskData updates inactive cached kanban queries after off-board task changes", async () => {
    let currentStatus: TaskCard["status"] = "ready_for_dev";
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(args);
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeRepo: "/repo",
          refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
        },
      },
      { wrapper },
    );

    try {
      await queryClient.fetchQuery(kanbanTaskListQueryOptions("/repo", 1));
      expect(
        queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/repo", 1))?.[0]?.status,
      ).toBe("ready_for_dev");

      await harness.mount();
      await harness.waitFor(() => latest?.tasks[0]?.status === "ready_for_dev");

      tasksList.mockClear();
      runsList.mockClear();
      currentStatus = "in_progress";

      await harness.run(async () => {
        if (!latest) {
          throw new Error("Hook not mounted");
        }

        await latest.refreshTaskData("/repo");
      });

      await harness.waitFor(
        () =>
          latest?.tasks[0]?.status === "in_progress" &&
          queryClient.getQueryData<TaskCard[]>(taskQueryKeys.kanbanData("/repo", 1))?.[0]
            ?.status === "in_progress",
      );

      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args.length === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(runsList).toHaveBeenCalledWith("/repo");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("refreshTaskData refreshes cached task detail documents after off-board workflow updates", async () => {
    let currentStatus: TaskCard["status"] = "ready_for_dev";
    let currentPlanMarkdown = "";
    let currentPlanUpdatedAt: string | null = null;
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const readTaskDocument = async (_repoPath: string, _taskId: string, section: string) => {
      if (section === "plan") {
        return {
          markdown: currentPlanMarkdown,
          updatedAt: currentPlanUpdatedAt,
        };
      }

      return { markdown: "", updatedAt: null };
    };
    const taskDocumentGet = mock(readTaskDocument);
    const taskDocumentGetFresh = mock(readTaskDocument);

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
      taskDocumentGet: host.taskDocumentGet,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;
    host.taskDocumentGet = taskDocumentGet;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    const queryClient = createQueryClient();
    let latest: {
      operations: ReturnType<typeof useTaskOperations>;
      planMarkdown: string;
      planLoaded: boolean;
    } | null = null;
    const getLatestState = () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      const operations = useTaskOperations(args);
      const { planDoc } = useTaskDocuments("A", true, args.activeRepo ?? "");
      latest = {
        operations,
        planMarkdown: planDoc.markdown,
        planLoaded: planDoc.loaded,
      };
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeRepo: "/repo",
          refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
        tasks: [makeTask("A", "ready_for_dev")],
        runs: [] satisfies RunSummary[],
      });
      queryClient.setQueryData(documentQueryKeys.plan("/repo", "A"), {
        markdown: "",
        updatedAt: null,
      });
      await harness.mount();
      expect(getLatestState().planMarkdown).toBe("");

      tasksList.mockClear();
      runsList.mockClear();
      taskDocumentGetFresh.mockClear();
      currentStatus = "in_progress";
      currentPlanMarkdown = "# New plan";
      currentPlanUpdatedAt = "2026-03-28T00:00:00.000Z";

      await harness.run(async () => {
        await getLatestState().operations.refreshTaskData("/repo", "A");
      });

      await harness.waitFor(
        () =>
          queryClient.getQueryData<{
            tasks: TaskCard[];
            runs: RunSummary[];
          }>(taskQueryKeys.repoData("/repo"))?.tasks[0]?.status === "in_progress" &&
          queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
            documentQueryKeys.plan("/repo", "A"),
          )?.markdown === "# New plan",
        3000,
      );

      expect(host.taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "A", "plan");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.plan("/repo", "A"),
        )?.markdown,
      ).toBe("# New plan");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      host.taskDocumentGet = original.taskDocumentGet;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
    }
  });

  test("deleteTask removes cached task documents for deleted tasks and subtasks", async () => {
    let isDeleted = false;
    const taskDelete = mock(async () => {
      isDeleted = true;
      return { ok: true };
    });
    const tasksList = mock(async () =>
      isDeleted ? [] : [{ ...makeTask("A", "open"), subtaskIds: ["B"] }, makeTask("B", "open")],
    );
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskDelete: host.taskDelete,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskDelete = taskDelete;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(args);
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeRepo: "/repo",
          refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
        tasks: [{ ...makeTask("A", "open"), subtaskIds: ["B"] }, makeTask("B", "open")],
        runs: [] satisfies RunSummary[],
      });
      queryClient.setQueryData(documentQueryKeys.spec("/repo", "A"), {
        markdown: "# Parent spec",
        updatedAt: "2026-03-28T00:00:00.000Z",
      });
      queryClient.setQueryData(documentQueryKeys.plan("/repo", "B"), {
        markdown: "# Child plan",
        updatedAt: "2026-03-28T00:00:00.000Z",
      });

      await harness.mount();
      await harness.run(async () => {
        if (!latest) {
          throw new Error("Hook not mounted");
        }

        await latest.deleteTask("A", true);
      });

      await harness.waitFor(
        () =>
          queryClient.getQueryData<{ tasks: TaskCard[]; runs: RunSummary[] }>(
            taskQueryKeys.repoData("/repo"),
          )?.tasks.length === 0,
        1000,
      );

      expect(taskDelete).toHaveBeenCalledWith("/repo", "A", true);
      expect(queryClient.getQueryData(documentQueryKeys.spec("/repo", "A"))).toBeUndefined();
      expect(queryClient.getQueryData(documentQueryKeys.plan("/repo", "B"))).toBeUndefined();
    } finally {
      await harness.unmount();
      host.taskDelete = original.taskDelete;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("completed ODT tool events refresh an active kanban query through the session listener", async () => {
    let currentStatus: TaskCard["status"] = "human_review";
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const adapterHandlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        adapterHandlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const original = {
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildAgentSession(),
      },
    };
    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }

      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          !value.isFetchingKanban &&
          value.operations.tasks[0]?.status === "human_review" &&
          value.kanbanTasks[0]?.status === "human_review",
        1000,
      );

      const unsubscribe = attachAgentSessionListener({
        adapter,
        repoPath: "/repo",
        sessionId: "session-1",
        sessionsRef,
        draftRawBySessionRef: { current: {} },
        draftSourceBySessionRef: { current: {} },
        draftMessageIdBySessionRef: { current: {} },
        draftFlushTimeoutBySessionRef: { current: {} },
        turnStartedAtBySessionRef: { current: {} },
        updateSession,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
        refreshTaskData: harness.getLatest().operations.refreshTaskData,
      });

      try {
        const handleEvent = adapterHandlers[0];
        if (!handleEvent) {
          throw new Error("Expected session event handler to be registered");
        }

        tasksList.mockClear();
        runsList.mockClear();
        currentStatus = "closed";

        handleEvent({
          type: "assistant_part",
          sessionId: "session-1",
          timestamp: "2026-02-22T08:00:05.000Z",
          part: {
            kind: "tool",
            messageId: "tool-msg-1",
            partId: "part-1",
            callId: "call-1",
            tool: "odt_build_completed",
            status: "completed",
            output: "done",
            error: "",
          },
        });

        await harness.waitFor(
          (value) =>
            !value.isFetchingKanban &&
            value.operations.tasks[0]?.status === "closed" &&
            value.kanbanTasks[0]?.status === "closed",
          1000,
        );

        expect(
          tasksList.mock.calls.some((call) => {
            const args = call as unknown[];
            return args[0] === "/repo" && args.length === 1;
          }),
        ).toBe(true);
        expect(
          tasksList.mock.calls.some((call) => {
            const args = call as unknown[];
            return args[0] === "/repo" && args[1] === 1;
          }),
        ).toBe(true);
        expect(runsList).toHaveBeenCalledWith("/repo");
      } finally {
        unsubscribe();
      }
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("syncPullRequests links a detected pull request for the task", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "linked" as const,
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "open" as const,
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: undefined,
        closedAt: undefined,
      },
    }));
    const tasksList = mock(async () => [
      {
        ...makeTask("A", "human_review"),
        pullRequest: {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "open" as const,
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: undefined,
          closedAt: undefined,
        },
      },
    ]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().tasks[0]?.pullRequest?.number).toBe(17);
      expect(toastSuccess).toHaveBeenCalledWith("Pull request linked", {
        description: "PR #17",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("syncPullRequests tracks only the detecting task while the request is pending", async () => {
    const detection = createDeferred<{
      outcome: "linked";
      pullRequest: {
        providerId: "github";
        number: number;
        url: string;
        state: "open";
        createdAt: string;
        updatedAt: string;
        lastSyncedAt: string;
        mergedAt: undefined;
        closedAt: undefined;
      };
    }>();
    const taskPullRequestDetect = mock(async () => detection.promise);
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => !value.isLoadingTasks);

      let syncPromise: Promise<void> | null = null;
      await harness.run((value) => {
        syncPromise = value.syncPullRequests("A");
      });

      expect(harness.getLatest().detectingPullRequestTaskId).toBe("A");
      expect(harness.getLatest().unlinkingPullRequestTaskId).toBeNull();
      expect(harness.getLatest().isLoadingTasks).toBe(false);

      await harness.run(async () => {
        detection.resolve({
          outcome: "linked",
          pullRequest: {
            providerId: "github",
            number: 17,
            url: "https://github.com/openai/openducktor/pull/17",
            state: "open",
            createdAt: "2026-02-20T10:00:00Z",
            updatedAt: "2026-02-20T10:00:00Z",
            lastSyncedAt: "2026-02-20T10:00:00Z",
            mergedAt: undefined,
            closedAt: undefined,
          },
        });
        await syncPromise;
      });

      expect(harness.getLatest().detectingPullRequestTaskId).toBeNull();
    } finally {
      detection.resolve({
        outcome: "linked",
        pullRequest: {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "open",
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: undefined,
          closedAt: undefined,
        },
      });
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("syncPullRequests stores merged pull requests for confirmation", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "merged" as const,
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "merged" as const,
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: "2026-02-20T10:00:00Z",
        closedAt: "2026-02-20T10:00:00Z",
      },
    }));
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(harness.getLatest().pendingMergedPullRequest).toEqual({
        taskId: "A",
        pullRequest: {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "merged",
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: "2026-02-20T10:00:00Z",
          closedAt: "2026-02-20T10:00:00Z",
        },
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("linkMergedPullRequest links the merged pull request and refreshes task data", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "merged" as const,
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "merged" as const,
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: "2026-02-20T10:00:00Z",
        closedAt: "2026-02-20T10:00:00Z",
      },
    }));
    const taskPullRequestLinkMerged = mock(async () => makeTask("A", "closed"));
    const tasksList = mock(async () => [makeTask("A", "closed")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.taskPullRequestLinkMerged = taskPullRequestLinkMerged;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });
      await harness.run(async (value) => {
        await value.linkMergedPullRequest();
      });

      expect(taskPullRequestLinkMerged).toHaveBeenCalledWith("/repo", "A", {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "merged",
        createdAt: "2026-02-20T10:00:00Z",
        updatedAt: "2026-02-20T10:00:00Z",
        lastSyncedAt: "2026-02-20T10:00:00Z",
        mergedAt: "2026-02-20T10:00:00Z",
        closedAt: "2026-02-20T10:00:00Z",
      });
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(harness.getLatest().linkingMergedPullRequestTaskId).toBeNull();
      expect(toastSuccess).toHaveBeenCalledWith("Merged pull request linked", {
        description: "PR #17; task moved to Done.",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.taskPullRequestLinkMerged = original.taskPullRequestLinkMerged;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("linkMergedPullRequest refreshes an active kanban query after moving a task to done", async () => {
    const mergedPullRequest = {
      providerId: "github" as const,
      number: 17,
      url: "https://github.com/openai/openducktor/pull/17",
      state: "merged" as const,
      createdAt: "2026-02-20T10:00:00Z",
      updatedAt: "2026-02-20T10:00:00Z",
      lastSyncedAt: "2026-02-20T10:00:00Z",
      mergedAt: "2026-02-20T10:00:00Z",
      closedAt: "2026-02-20T10:00:00Z",
    };
    let currentStatus: TaskCard["status"] = "human_review";
    const taskPullRequestDetect = mock(async () => ({
      outcome: "merged" as const,
      pullRequest: mergedPullRequest,
    }));
    const taskPullRequestLinkMerged = mock(async () => {
      currentStatus = "closed";
      return makeTask("A", currentStatus);
    });
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.taskPullRequestLinkMerged = taskPullRequestLinkMerged;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          !value.isFetchingKanban &&
          value.operations.tasks[0]?.status === "human_review" &&
          value.kanbanTasks[0]?.status === "human_review",
        1000,
      );
      tasksList.mockClear();
      runsList.mockClear();

      await harness.run(async (value) => {
        await value.operations.syncPullRequests("A");
      });

      expect(harness.getLatest().operations.pendingMergedPullRequest).toEqual({
        taskId: "A",
        pullRequest: mergedPullRequest,
      });
      expect(tasksList).not.toHaveBeenCalled();

      await harness.run(async (value) => {
        await value.operations.linkMergedPullRequest();
      });
      await harness.waitFor(
        (value) =>
          !value.isFetchingKanban &&
          value.operations.tasks[0]?.status === "closed" &&
          value.kanbanTasks[0]?.status === "closed",
        1000,
      );

      expect(taskPullRequestLinkMerged).toHaveBeenCalledWith("/repo", "A", mergedPullRequest);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args.length === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(runsList).toHaveBeenCalledWith("/repo");
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.taskPullRequestLinkMerged = original.taskPullRequestLinkMerged;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
    }
  });

  test("linkMergedPullRequest surfaces an actionable error when merged PR state is missing", async () => {
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.linkMergedPullRequest();
      });

      expect(toastError).toHaveBeenCalledWith("Merged pull request state expired", {
        description: "Re-run pull request detection and try again.",
      });
    } finally {
      await harness.unmount();
      toast.error = originalToastError;
    }
  });

  test("syncPullRequests warns when no pull request exists for the task branch", async () => {
    const taskPullRequestDetect = mock(async () => ({
      outcome: "not_found" as const,
      sourceBranch: "odt/task-1",
      targetBranch: "main",
    }));
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastWarning = toast.warning;
    const toastWarning = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { warning: typeof toast.warning }).warning =
      toastWarning as unknown as typeof toast.warning;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(toastWarning).toHaveBeenCalledWith("No pull request found", {
        description: "No open GitHub pull request found for odt/task-1.",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.warning = originalToastWarning;
    }
  });

  test("syncPullRequests reports pull request detection errors without rethrowing", async () => {
    const taskPullRequestDetect = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    host.runsList = runsList;
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to detect pull request", {
        description: "gh auth expired",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = originalToastError;
    }
  });

  test("syncPullRequests reports missing workspace selection without rethrowing", async () => {
    const taskPullRequestDetect = mock(async () => {
      throw new Error("taskPullRequestDetect should not be called without an active workspace");
    });
    const toastError = mock(() => "");
    const originalTaskPullRequestDetect = host.taskPullRequestDetect;
    const originalToastError = toast.error;
    host.taskPullRequestDetect = taskPullRequestDetect;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: null,
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });

      expect(taskPullRequestDetect).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to detect pull request", {
        description: "Select a workspace first.",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = originalTaskPullRequestDetect;
      toast.error = originalToastError;
    }
  });

  test("unlinkPullRequest reports unlink errors without rethrowing", async () => {
    const taskPullRequestUnlink = mock(async () => {
      throw new Error("unlink failed");
    });
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestUnlink: host.taskPullRequestUnlink,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    host.runsList = runsList;
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.unlinkPullRequest("A");
      });

      expect(taskPullRequestUnlink).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).not.toHaveBeenCalled();
      expect(runsList).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to unlink pull request", {
        description: "unlink failed",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.error = originalToastError;
    }
  });

  test("unlinkPullRequest refreshes tasks after removing a linked pull request", async () => {
    const taskPullRequestUnlink = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestUnlink: host.taskPullRequestUnlink,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.unlinkPullRequest("A");
      });

      expect(taskPullRequestUnlink).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).toHaveBeenCalledWith("/repo");
      expect(runsList).toHaveBeenCalledWith("/repo");
      expect(harness.getLatest().tasks[0]?.pullRequest).toBeUndefined();
      expect(toastSuccess).toHaveBeenCalledWith("Pull request unlinked", {
        description: "A",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
      host.tasksList = original.tasksList;
      host.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("unlinkPullRequest tracks only the unlinking task while the request is pending", async () => {
    const unlink = createDeferred<{ ok: boolean }>();
    const taskPullRequestUnlink = mock(async () => unlink.promise);
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestUnlink: host.taskPullRequestUnlink,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => !value.isLoadingTasks);

      let unlinkPromise: Promise<void> | null = null;
      await harness.run((value) => {
        unlinkPromise = value.unlinkPullRequest("A");
      });

      expect(harness.getLatest().unlinkingPullRequestTaskId).toBe("A");
      expect(harness.getLatest().detectingPullRequestTaskId).toBeNull();
      expect(harness.getLatest().isLoadingTasks).toBe(false);

      await harness.run(async () => {
        unlink.resolve({ ok: true });
        await unlinkPromise;
      });

      expect(harness.getLatest().unlinkingPullRequestTaskId).toBeNull();
    } finally {
      unlink.resolve({ ok: true });
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
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
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    const input: TaskCreateInput = {
      title: "  Ship feature  ",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
      labels: [],
      description: "",
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

  test("createTask refreshes an active kanban query without remounting the board", async () => {
    let currentTasks: TaskCard[] = [];
    const taskCreate = mock(
      async (_repoPath: string, input: TaskCreateInput): Promise<TaskCard> => {
        const createdTask = {
          ...makeTask("A", "open"),
          title: input.title,
        };
        currentTasks = [createdTask];
        return createdTask;
      },
    );
    const tasksList = mock(async () => currentTasks);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskCreate: host.taskCreate,
      tasksList: host.tasksList,
      runsList: host.runsList,
    };
    host.taskCreate = taskCreate;
    host.tasksList = tasksList;
    host.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    const input: TaskCreateInput = {
      title: "  Ship feature  ",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
      labels: [],
      description: "",
    };

    try {
      await harness.mount();
      await harness.waitFor(
        (value) => !value.operations.isLoadingTasks && !value.isFetchingKanban,
        1000,
      );
      tasksList.mockClear();
      runsList.mockClear();

      await harness.run(async (value) => {
        await value.operations.createTask(input);
      });
      await harness.waitFor(
        (value) => value.operations.tasks[0]?.id === "A" && value.kanbanTasks[0]?.id === "A",
        1000,
      );

      expect(taskCreate).toHaveBeenCalledWith("/repo", {
        ...input,
        title: "Ship feature",
      });
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args.length === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(runsList).toHaveBeenCalledWith("/repo");
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
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
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
      refreshBeadsCheckForRepo: async (): Promise<BeadsCheck> => makeBeadsCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
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
