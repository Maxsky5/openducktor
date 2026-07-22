import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  TaskCard,
  TaskCreateInput,
  TaskStoreCheck,
} from "@openducktor/contracts";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { toast } from "sonner";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import {
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "@/components/features/agents/agent-chat/agent-chat-draft-storage";
import {
  resetAgentChatDraftStoreForTests,
  setAgentChatDraftStorageForTests,
} from "@/components/features/agents/agent-chat/agent-chat-draft-store";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { isKanbanForegroundLoading } from "@/pages/kanban/use-kanban-page-models";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createSettingsSnapshotFixture as createSharedSettingsSnapshotFixture,
  createTaskStoreCheckFixture as createSharedTaskStoreCheckFixture,
  type TaskStoreCheckFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { type AgentSessionReadPort, agentSessionQueryKeys } from "../../queries/agent-sessions";
import { documentQueryKeys } from "../../queries/documents";
import { repoTaskDataQueryOptions, taskQueryKeys } from "../../queries/tasks";
import { workspaceQueryKeys } from "../../queries/workspace";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import { host } from "../shared/host";
import { useTaskOperations } from "./use-task-operations";

type LegacyRunSummary = {
  runId: string;
  runtimeKind: string;
  runtimeRoute: { type: "local_http"; endpoint: string } | { type: "stdio"; identity: string };
  repoPath: string;
  taskId: string;
  branch: string;
  worktreePath: string;
  port: number | null;
  state: string;
  lastMessage: string | null;
  startedAt: string;
};

const legacyHost = host as typeof host & {
  runsList: (repoPath?: string) => Promise<LegacyRunSummary[]>;
};

type RunSummary = LegacyRunSummary;
type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type TestStorageSpies = {
  removeItem?: (key: string) => void;
};

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalToastSuccess = toast.success;
const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;

const createSettingsSnapshotFixture = () => createSharedSettingsSnapshotFixture();

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

const createMemoryStorage = (spies?: TestStorageSpies): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      spies?.removeItem?.(key);
      store.delete(key);
    },
  };
};

const writeTestDraft = (
  storage: TestStorage,
  identity: AgentChatDraftSessionIdentity,
  text: string,
): void => {
  writeAgentChatDraftToStorage({
    storage,
    identity,
    taskId: "task-1",
    draft: { segments: [createTextSegment(text, "text-1")], attachments: [] },
    updatedAt: "2026-07-08T10:00:00.000Z",
  });
};

const createDraftIdentity = (
  externalSessionId: string,
  workingDirectory = "/repo",
): AgentChatDraftSessionIdentity => ({
  workspaceId: "repo",
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory,
});

const makeTask = (id: string, status: TaskCard["status"]): TaskCard => ({
  id,
  title: id,
  description: "",
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
  externalSessionId: "external-1",
  taskId: "A",
  role: "build",
  status: "running",
  runtimeStatusMessage: null,
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/repo",
  messages: createSessionMessagesState(overrides.externalSessionId ?? "external-1"),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
  historyLoadState: overrides.historyLoadState ?? "not_requested",
});

const buildAgentSessionRecord = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/repo",
  selectedModel: null,
  ...overrides,
});

const makeTaskStoreCheck = (overrides: TaskStoreCheckFixtureOverrides = {}): TaskStoreCheck =>
  createSharedTaskStoreCheckFixture({}, overrides);

type HookArgs = Parameters<typeof useTaskOperations>[0];
type LegacyHookArgs = Omit<HookArgs, "activeWorkspace"> & {
  activeWorkspace?: ActiveWorkspace | null;
  activeRepo?: string | null;
  refreshTaskStoreCheckForRepo?: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
};

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const testAgentSessionReadPort: AgentSessionReadPort = {
  agentSessionsList: async () => [],
  agentSessionsListForTasks: async (_repoPath, taskIds) =>
    taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
};

const normalizeHookArgs = ({
  activeWorkspace,
  activeRepo,
  refreshTaskStoreCheckForRepo: _refreshTaskStoreCheckForRepo,
  ...rest
}: LegacyHookArgs): HookArgs => ({
  ...rest,
  activeWorkspace: activeWorkspace ?? (activeRepo ? createActiveWorkspace(activeRepo) : null),
  agentSessionReadPort: rest.agentSessionReadPort ?? testAgentSessionReadPort,
});

const createHookHarness = (initialArgs: LegacyHookArgs) => {
  let latest: ReturnType<typeof useTaskOperations> | null = null;
  let currentArgs = normalizeHookArgs(initialArgs);

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useTaskOperations(normalizeHookArgs(args));
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
    updateArgs: async (nextArgs: LegacyHookArgs) => {
      currentArgs = normalizeHookArgs(nextArgs);
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

type ScheduledKanbanRefetchCase = {
  initialTasks: TaskCard[];
  expectedVisibleTaskId: string | undefined;
};

const createTaskAndKanbanHarness = (initialArgs: LegacyHookArgs, doneVisibleDays = 1) => {
  let latest: TaskAndKanbanHarnessState | null = null;
  const currentArgs = normalizeHookArgs(initialArgs);

  const Harness = ({ args }: { args: HookArgs }) => {
    const operations = useTaskOperations(normalizeHookArgs(args));
    const activeRepoPath = args.activeWorkspace?.repoPath ?? null;
    const kanbanTaskListQuery = useQuery({
      ...repoTaskDataQueryOptions(activeRepoPath ?? "__disabled__", doneVisibleDays),
      enabled: activeRepoPath !== null,
    });

    latest = {
      operations,
      kanbanTasks: activeRepoPath ? (kanbanTaskListQuery.data?.tasks ?? []) : [],
      isPendingKanban: activeRepoPath !== null && kanbanTaskListQuery.isPending,
      isFetchingKanban:
        activeRepoPath !== null &&
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
}: ScheduledKanbanRefetchCase): Promise<void> => {
  const repoPullRequestSyncDeferred = createDeferred<{ ok: boolean }>();
  let repoTaskListCallCount = 0;
  let kanbanTaskListCallCount = 0;
  let runsListCallCount = 0;
  const repoTaskRefreshDeferred = createDeferred<TaskCard[]>();
  const kanbanRefreshDeferred = createDeferred<TaskCard[]>();
  const runsRefreshDeferred = createDeferred<RunSummary[]>();
  const repoPullRequestSync = mock(async () => repoPullRequestSyncDeferred.promise);
  const tasksList = mock(async (_repoPath: string, doneVisibleDays?: number) => {
    repoTaskListCallCount += 1;
    if (typeof doneVisibleDays === "number") {
      kanbanTaskListCallCount += 1;
      return kanbanTaskListCallCount === 1 ? initialTasks : kanbanRefreshDeferred.promise;
    }

    return repoTaskListCallCount === 1 ? initialTasks : repoTaskRefreshDeferred.promise;
  });
  const runsList = mock(async (): Promise<RunSummary[]> => {
    runsListCallCount += 1;
    return runsListCallCount === 1 ? [] : runsRefreshDeferred.promise;
  });

  const original = {
    repoPullRequestSync: host.repoPullRequestSync,
    tasksList: host.tasksList,
    runsList: legacyHost.runsList,
  };
  host.repoPullRequestSync = repoPullRequestSync;
  host.tasksList = tasksList;
  legacyHost.runsList = runsList;

  const harness = createTaskAndKanbanHarness({
    activeRepo: "/repo",
    refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
    const scheduledRefreshRun = harness.run((value) => {
      scheduledRefreshPromise = value.operations.refreshTasksWithOptions({ trigger: "scheduled" });
    });
    if (!scheduledRefreshPromise) {
      throw new Error("Expected scheduled refresh promise to be created");
    }
    await scheduledRefreshRun;

    await harness.run(async () => {
      repoPullRequestSyncDeferred.resolve({ ok: true });
    });
    await harness.waitFor(
      (value) => !value.isPendingKanban && value.isFetchingKanban && kanbanTaskListCallCount >= 2,
      1000,
    );

    const latest = harness.getLatest();
    const foregroundLoading = isKanbanForegroundLoading({
      hasActiveWorkspace: true,
      isForegroundLoadingTasks: latest.operations.isForegroundLoadingTasks,
      isSettingsPending: false,
      isScrollbarPlatformUnresolved: false,
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
    legacyHost.runsList = original.runsList;
  }
};

describe("use-task-operations", () => {
  beforeEach(async () => {
    (toast as { success: typeof toast.success }).success = mock(
      (_message: string, _options?: { description?: string }) => "",
    ) as unknown as typeof toast.success;
    host.workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshotFixture()) as never;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    toast.success = originalToastSuccess;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    resetAgentChatDraftStoreForTests();
  });

  test("refreshTaskData keeps host task results intact", async () => {
    const tasksList = mock(async () => [makeTask("A", "open"), makeTask("B", "blocked")]);
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
      runsList: legacyHost.runsList,
    };
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> =>
        makeTaskStoreCheck({
          taskStoreOk: false,
          taskStorePath: null,
          taskStoreError: "missing store",
          repoStoreHealth: {
            category: "database_unavailable",
            status: "blocking",
            isReady: false,
            detail: "missing store",
            databasePath: null,
          },
        }),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.status === "open");
      await harness.run(async (value) => {
        await value.refreshTaskData("/repo");
      });
      await harness.waitFor((value) => value.tasks.map((task) => task.id).join(",") === "A,B");

      expect(harness.getLatest().tasks.map((task) => task.id)).toEqual(["A", "B"]);
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> =>
        makeTaskStoreCheck({
          taskStoreOk: false,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: "task store unavailable",
          repoStoreHealth: {
            category: "database_unavailable",
            status: "blocking",
            isReady: false,
            detail: "task store unavailable",
            databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          },
        }),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.status === "open");
      expect(harness.getLatest().tasks[0]?.status).toBe("open");

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
      expect(harness.getLatest().tasks[0]?.status).toBe("ready_for_dev");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("settings load failure does not leave task loading stuck", async () => {
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    const queryClient = createQueryClient();
    const original = {
      tasksList: host.tasksList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
      toastError: toast.error,
    };
    host.tasksList = tasksList;
    host.workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("settings unavailable");
    }) as never;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );
    queryClient.setQueryData(taskQueryKeys.repoData("/repo", 1), {
      tasks: [makeTask("cached", "open")],
    });
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.settingsSnapshot(),
      exact: true,
      refetchType: "none",
    });

    let latest: ReturnType<typeof useTaskOperations> | null = null;
    const args = normalizeHookArgs({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });
    const Harness = () => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };
    const getLatest = (): ReturnType<typeof useTaskOperations> => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    };
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const harness = createSharedHookHarness(Harness, {}, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor(() => toastError.mock.calls.length > 0);

      await harness.waitFor(() => getLatest().tasks[0]?.id === "cached");

      expect(tasksList).not.toHaveBeenCalled();
      expect(getLatest().tasks[0]?.id).toBe("cached");
      expect(toastError).toHaveBeenCalledWith("Failed to load tasks", {
        description: "settings unavailable",
      });
    } finally {
      await harness.unmount();
      queryClient.clear();
      host.tasksList = original.tasksList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
      toast.error = original.toastError;
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
      runsList: legacyHost.runsList,
    };
    host.taskResetImplementation = taskResetImplementation;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
    }
  });

  test("external task-sync supersedes a targeted reset refresh without false failure", async () => {
    const localTaskRead = createDeferred<TaskCard[]>();
    let currentStatus: TaskCard["status"] = "in_progress";
    let deferLocalTaskRead = false;
    const taskResetImplementation = mock(async () => {
      currentStatus = "ready_for_dev";
      return makeTask("A", currentStatus);
    });
    const tasksList = mock(async () => {
      if (deferLocalTaskRead) {
        deferLocalTaskRead = false;
        return localTaskRead.promise;
      }
      return [makeTask("A", currentStatus)];
    });
    const taskDocumentGetFresh = mock(async () => ({
      markdown: "# Fresh spec",
      updatedAt: "2026-04-10T13:10:00.000Z",
    }));
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    const original = {
      taskResetImplementation: host.taskResetImplementation,
      tasksList: host.tasksList,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
      toastError: toast.error,
      toastSuccess: toast.success,
    };
    host.taskResetImplementation = taskResetImplementation;
    host.tasksList = tasksList;
    host.taskDocumentGetFresh = taskDocumentGetFresh;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;
    (toast as { success: typeof toast.success }).success = toastSuccess as typeof toast.success;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;
    const getLatest = () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    };
    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          agentSessionReadPort: {
            agentSessionsList: async () => [],
            agentSessionsListForTasks: async (_repoPath, taskIds) =>
              taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
          },
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(documentQueryKeys.spec("/repo", "A"), {
        markdown: "# Stale spec",
        updatedAt: null,
      });
      await harness.mount();
      await harness.waitFor(() => getLatest().tasks[0]?.status === "in_progress");
      tasksList.mockClear();

      deferLocalTaskRead = true;
      let resetPromise: Promise<void> | null = null;
      await harness.run(() => {
        resetPromise = getLatest().resetTaskImplementation("A");
      });
      await harness.waitFor(() => tasksList.mock.calls.length === 1);

      await harness.run(async () => {
        await getLatest().refreshTaskData("/repo", "A", { source: "external-sync" });
      });
      if (!resetPromise) {
        throw new Error("Expected reset to start");
      }
      await harness.run(async () => {
        await resetPromise;
      });

      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledWith("Implementation reset", { description: "A" });
      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 1))
          ?.tasks[0]?.status,
      ).toBe("ready_for_dev");
      expect(taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "A", "spec");
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.spec("/repo", "A"),
        )?.markdown,
      ).toBe("# Fresh spec");
    } finally {
      localTaskRead.resolve([makeTask("A", "in_progress")]);
      await harness.unmount();
      host.taskResetImplementation = original.taskResetImplementation;
      host.tasksList = original.tasksList;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
      toast.error = original.toastError;
      toast.success = original.toastSuccess;
    }
  });

  test("targeted task refresh propagates task-list and document failures", async () => {
    let taskListFailure: Error | null = null;
    let documentFailure: Error | null = null;
    const tasksList = mock(async () => {
      if (taskListFailure) {
        throw taskListFailure;
      }
      return [makeTask("A", "open")];
    });
    const taskDocumentGetFresh = mock(async () => {
      if (documentFailure) {
        throw documentFailure;
      }
      return { markdown: "# Fresh spec", updatedAt: "2026-04-10T13:10:00.000Z" };
    });
    const original = {
      tasksList: host.tasksList,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.tasksList = tasksList;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;
    const getLatest = () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    };
    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => getLatest().tasks[0]?.status === "open");

      taskListFailure = new Error("task list unavailable");
      await expect(
        harness.run(async () => {
          await getLatest().refreshTaskData("/repo", "A");
        }),
      ).rejects.toThrow("task list unavailable");

      taskListFailure = null;
      documentFailure = new Error("document unavailable");
      queryClient.setQueryData(documentQueryKeys.spec("/repo", "A"), {
        markdown: "# Stale spec",
        updatedAt: null,
      });
      await expect(
        harness.run(async () => {
          await getLatest().refreshTaskData("/repo", "A");
        }),
      ).rejects.toThrow("document unavailable");
      expect(taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "A", "spec");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
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
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
    const agentSessionsList = mock(async () => []);

    const original = {
      taskReset: host.taskReset,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      taskDocumentGet: host.taskDocumentGet,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.taskReset = taskReset;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
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
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          agentSessionReadPort: {
            agentSessionsList,
            agentSessionsListForTasks: async (_repoPath, taskIds) =>
              taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
          },
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      expect(agentSessionsList).toHaveBeenCalledWith("/repo", "A");
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "A")),
      ).toEqual([]);
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
      legacyHost.runsList = original.runsList;
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
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      runsList: legacyHost.runsList,
    };
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const refreshTaskStoreCheckForRepo = async (): Promise<TaskStoreCheck> => makeTaskStoreCheck();
    const harness = createHookHarness({
      activeRepo: "/repo-a",
      refreshTaskStoreCheckForRepo,
    });

    try {
      await harness.mount();

      let refreshPromise: Promise<void> | null = null;
      const refreshRun = harness.run((value) => {
        refreshPromise = value.refreshTaskData("/repo-a");
      });
      if (!refreshPromise) {
        throw new Error("refreshTaskData promise was not captured");
      }
      await refreshRun;

      await harness.updateArgs({
        activeRepo: "/repo-b",
        refreshTaskStoreCheckForRepo,
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
    } finally {
      deferredTasks.resolve([]);
      deferredRuns.resolve([]);
      await harness.unmount();
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("refreshTasks reloads task data without blocking on pull request sync", async () => {
    const repoPullRequestSync = mock(async () => {
      throw new Error("gh auth expired");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      tasksList.mockClear();
      runsList.mockClear();

      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(repoPullRequestSync).not.toHaveBeenCalled();
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
      expect(runsList).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("refreshTasks leaves task-store diagnostics to the diagnostics flow", async () => {
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const refreshTaskStoreCheckForRepo = mock(
      async (_repoPath: string, force = false): Promise<TaskStoreCheck> =>
        force
          ? makeTaskStoreCheck({ taskStorePath: null })
          : makeTaskStoreCheck({
              taskStoreOk: false,
              taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              taskStoreError: "SQLite task store database is unavailable",
              repoStoreHealth: {
                category: "database_unavailable",
                status: "blocking",
                isReady: false,
                detail: "SQLite task store database is unavailable",
                databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
              },
            }),
    );

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo,
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      refreshTaskStoreCheckForRepo.mockClear();

      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(refreshTaskStoreCheckForRepo).not.toHaveBeenCalled();
      expect(repoPullRequestSync).not.toHaveBeenCalled();
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("scheduled and manual refresh join the same in-flight task read", async () => {
    const taskRefreshDeferred = createDeferred<TaskCard[]>();
    let deferRefresh = false;
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () =>
      deferRefresh ? taskRefreshDeferred.promise : [makeTask("A", "open")],
    );
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      tasksList.mockClear();
      runsList.mockClear();
      deferRefresh = true;

      let scheduledRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        scheduledRefreshPromise = value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      let manualRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        manualRefreshPromise = value.refreshTasks();
      });
      await harness.waitFor((value) => value.isLoadingTasks);

      expect(repoPullRequestSync).not.toHaveBeenCalled();

      if (!scheduledRefreshPromise || !manualRefreshPromise) {
        throw new Error("Expected both refresh promises to be created");
      }

      await harness.run(async () => {
        taskRefreshDeferred.resolve([makeTask("B", "open")]);
        await Promise.all([scheduledRefreshPromise, manualRefreshPromise]);
      });
      await harness.waitFor((value) => !value.isLoadingTasks);

      expect(tasksList).toHaveBeenCalledTimes(1);
    } finally {
      taskRefreshDeferred.resolve([makeTask("B", "open")]);
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("scheduled and manual refresh share one toast when the joined task read fails", async () => {
    const taskRefreshDeferred = createDeferred<TaskCard[]>();
    let deferRefresh = false;
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () =>
      deferRefresh ? taskRefreshDeferred.promise : [makeTask("A", "open")],
    );
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      deferRefresh = true;

      let scheduledRefreshPromise: Promise<void> | null = null;
      const scheduledRefreshRun = harness.run((value) => {
        scheduledRefreshPromise = value.refreshTasksWithOptions({ trigger: "scheduled" });
      });
      if (!scheduledRefreshPromise) {
        throw new Error("Expected scheduled refresh promise to be created");
      }
      await scheduledRefreshRun;

      let manualRefreshPromise: Promise<void> | null = null;
      const manualRefreshRun = harness.run((value) => {
        manualRefreshPromise = value.refreshTasks();
      });
      if (!manualRefreshPromise) {
        throw new Error("Expected manual refresh promise to be created");
      }
      await manualRefreshRun;
      await harness.waitFor((value) => value.isLoadingTasks);

      await harness.run(async () => {
        taskRefreshDeferred.reject(new Error("task read failed"));
        await Promise.all([scheduledRefreshPromise, manualRefreshPromise]);
      });
      await harness.waitFor((value) => !value.isLoadingTasks);

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "task read failed",
      });
      expect(repoPullRequestSync).not.toHaveBeenCalled();
    } finally {
      taskRefreshDeferred.resolve([makeTask("A", "open")]);
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("refreshTasks reports task read failures", async () => {
    let shouldFailTaskRead = false;
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => {
      if (shouldFailTaskRead) {
        throw new Error("task read failed");
      }
      return [makeTask("A", "open")];
    });
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> =>
        makeTaskStoreCheck({
          taskStoreOk: false,
          taskStorePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          taskStoreError: "SQLite task store database is unavailable",
          repoStoreHealth: {
            category: "database_unavailable",
            status: "blocking",
            isReady: false,
            detail: "SQLite task store database is unavailable",
            databasePath: "/repo/.openducktor/task-stores/workspace/database.sqlite",
          },
        }),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      toastError.mockClear();
      shouldFailTaskRead = true;

      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "task read failed",
      });
      expect(repoPullRequestSync).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("an earlier manual refresh cannot clear a later repo refresh loading state", async () => {
    const repoARefreshDeferred = createDeferred<TaskCard[]>();
    const repoBRefreshDeferred = createDeferred<TaskCard[]>();
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    let deferRefresh = false;
    const tasksList = mock(async (repoPath: string) => {
      if (repoPath === "/repo-a") {
        if (deferRefresh) {
          return repoARefreshDeferred.promise;
        }
        return [makeTask("A", "open")];
      }

      if (deferRefresh) {
        return repoBRefreshDeferred.promise;
      }
      return [makeTask("B", "open")];
    });
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      deferRefresh = true;
      let repoAManualRefresh: Promise<void> | null = null;
      const repoAManualRefreshRun = harness.run((value) => {
        repoAManualRefresh = value.refreshTasks();
      });
      if (!repoAManualRefresh) {
        throw new Error("Expected repo A manual refresh promise to be created");
      }
      await repoAManualRefreshRun;
      await harness.waitFor((value) => value.isLoadingTasks);

      deferRefresh = false;
      await harness.updateArgs({
        activeRepo: "/repo-b",
        refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
      });
      await harness.waitFor((value) => value.tasks[0]?.id === "B");
      await harness.waitFor((value) => !value.isLoadingTasks);

      deferRefresh = true;
      let repoBManualRefresh: Promise<void> | null = null;
      const repoBManualRefreshRun = harness.run((value) => {
        repoBManualRefresh = value.refreshTasks();
      });
      if (!repoBManualRefresh) {
        throw new Error("Expected repo B manual refresh promise to be created");
      }
      await repoBManualRefreshRun;
      await harness.waitFor((value) => value.isLoadingTasks);

      await harness.run(async () => {
        repoARefreshDeferred.resolve([makeTask("A2", "open")]);
        await repoAManualRefresh;
      });

      expect(harness.getLatest().isLoadingTasks).toBe(true);

      await harness.run(async () => {
        repoBRefreshDeferred.resolve([makeTask("B2", "open")]);
        await repoBManualRefresh;
      });
      await harness.waitFor((value) => !value.isLoadingTasks);
    } finally {
      repoARefreshDeferred.resolve([makeTask("A2", "open")]);
      repoBRefreshDeferred.resolve([makeTask("B2", "open")]);
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("scheduled refresh keeps task loading state in background while repo data refetch is in flight", async () => {
    const taskRefreshDeferred = createDeferred<TaskCard[]>();
    let deferRefresh = false;
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () =>
      deferRefresh ? taskRefreshDeferred.promise : [makeTask("A", "open")],
    );
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      tasksList.mockClear();
      runsList.mockClear();
      deferRefresh = true;

      let scheduledRefreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        scheduledRefreshPromise = value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(harness.getLatest().isLoadingTasks).toBe(false);
      expect(repoPullRequestSync).not.toHaveBeenCalled();

      if (!scheduledRefreshPromise) {
        throw new Error("Expected scheduled refresh promise to be created");
      }

      await harness.run(async () => {
        taskRefreshDeferred.resolve([makeTask("B", "open")]);
        await scheduledRefreshPromise;
      });

      expect(harness.getLatest().isLoadingTasks).toBe(false);
      expect(tasksList).toHaveBeenCalledTimes(1);
    } finally {
      taskRefreshDeferred.resolve([makeTask("B", "open")]);
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
    let shouldFailTaskRead = false;
    const repoPullRequestSync = mock(async () => ({ ok: true }));
    const tasksList = mock(async () => {
      if (shouldFailTaskRead) {
        throw new Error("task read failed");
      }
      return [makeTask("A", "open")];
    });
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      repoPullRequestSync: host.repoPullRequestSync,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");
      toastError.mockClear();
      shouldFailTaskRead = true;

      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });
      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Failed to refresh tasks", {
        description: "task read failed",
      });

      shouldFailTaskRead = false;
      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      shouldFailTaskRead = true;
      await harness.run(async (value) => {
        await value.refreshTasksWithOptions({ trigger: "scheduled" });
      });

      expect(toastError).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
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
      runsList: legacyHost.runsList,
    };
    host.repoPullRequestSync = repoPullRequestSync;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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

      expect(repoPullRequestSync).not.toHaveBeenCalled();
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
    } finally {
      await harness.unmount();
      host.repoPullRequestSync = original.repoPullRequestSync;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("refreshTaskData updates inactive cached kanban queries after off-board task changes", async () => {
    let currentStatus: TaskCard["status"] = "ready_for_dev";
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      await queryClient.fetchQuery(repoTaskDataQueryOptions("/repo", 1));
      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.kanbanData("/repo", 1))
          ?.tasks[0]?.status,
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
          queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.kanbanData("/repo", 1))
            ?.tasks[0]?.status === "in_progress",
      );

      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
      taskDocumentGet: host.taskDocumentGet,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
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
      const operations = useTaskOperations(normalizeHookArgs(args));
      const { planDoc } = useTaskDocuments("A", true, args.activeWorkspace?.repoPath ?? "");
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
          activeWorkspace: createActiveWorkspace("/repo"),
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(taskQueryKeys.repoData("/repo", 1), {
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
          }>(taskQueryKeys.repoData("/repo", 1))?.tasks[0]?.status === "in_progress" &&
          queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
            documentQueryKeys.plan("/repo", "A"),
          )?.markdown === "# New plan",
        3000,
      );

      expect(host.taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "A", "plan");
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.plan("/repo", "A"),
        )?.markdown,
      ).toBe("# New plan");
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      host.taskDocumentGet = original.taskDocumentGet;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
    }
  });

  test("external refreshTaskData invalidates cached task detail documents without fetching them", async () => {
    const tasksList = mock(async () => [makeTask("A", "in_progress")]);
    const taskDocumentGetFresh = mock(async () => {
      throw new Error("document fetch should not run");
    });

    const original = {
      tasksList: host.tasksList,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.tasksList = tasksList;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;
    const getLatestOperations = () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    };

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(documentQueryKeys.plan("/repo", "A"), {
        markdown: "# Cached plan",
        updatedAt: null,
      });
      await harness.mount();

      await harness.run(async () => {
        await getLatestOperations().refreshTaskData("/repo", "A", { source: "external-sync" });
      });

      expect(taskDocumentGetFresh).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(documentQueryKeys.plan("/repo", "A"))?.isInvalidated).toBe(
        true,
      );
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
    }
  });

  test("external task-sync supersedes a local mutation refresh without failing the mutation", async () => {
    const localTaskRead = createDeferred<TaskCard[]>();
    let currentStatus: TaskCard["status"] = "open";
    let deferLocalTaskRead = false;
    const taskUpdate = mock(async () => {
      currentStatus = "ready_for_dev";
      return makeTask("A", currentStatus);
    });
    const tasksList = mock(async () => {
      if (deferLocalTaskRead) {
        deferLocalTaskRead = false;
        return localTaskRead.promise;
      }
      return [makeTask("A", currentStatus)];
    });
    const taskDocumentGetFresh = mock(async () => ({
      markdown: "# Fresh plan",
      updatedAt: "2026-04-10T13:10:00.000Z",
    }));
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    const original = {
      taskUpdate: host.taskUpdate,
      tasksList: host.tasksList,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
      toastError: toast.error,
    };
    host.taskUpdate = taskUpdate;
    host.tasksList = tasksList;
    host.taskDocumentGetFresh = taskDocumentGetFresh;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;
    const getLatestOperations = () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    };
    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      queryClient.setQueryData(documentQueryKeys.plan("/repo", "A"), {
        markdown: "# Stale plan",
        updatedAt: null,
      });
      await harness.mount();
      await harness.waitFor(() => latest?.tasks[0]?.status === "open");
      tasksList.mockClear();

      deferLocalTaskRead = true;
      let mutationPromise: Promise<void> | null = null;
      await harness.run(() => {
        mutationPromise = getLatestOperations().updateTask("A", { title: "Updated" });
      });
      await harness.waitFor(() => tasksList.mock.calls.length === 1);

      await harness.run(async () => {
        await getLatestOperations().refreshTaskData("/repo", "A", { source: "external-sync" });
      });
      if (!mutationPromise) {
        throw new Error("Expected mutation to start");
      }
      await harness.run(async () => {
        await mutationPromise;
      });

      expect(toastError).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData("/repo", 1))
          ?.tasks[0]?.status,
      ).toBe("ready_for_dev");
      expect(taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "A", "plan");
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.plan("/repo", "A"),
        )?.markdown,
      ).toBe("# Fresh plan");
    } finally {
      localTaskRead.resolve([makeTask("A", "open")]);
      await harness.unmount();
      host.taskUpdate = original.taskUpdate;
      host.tasksList = original.tasksList;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
      toast.error = original.toastError;
    }
  });

  test("deleteTask removes cached task documents for deleted tasks and subtasks", async () => {
    let isDeleted = false;
    let deletePromise: Promise<void> | null = null;
    const taskDeleted = createDeferred<void>();
    const deletedTasksList = createDeferred<TaskCard[]>();
    const taskDelete = mock(async () => {
      isDeleted = true;
      taskDeleted.resolve();
      return { ok: true };
    });
    const agentSessionsListForTasks = mock(async () => [
      {
        taskId: "A",
        agentSessions: [
          buildAgentSessionRecord({
            externalSessionId: "session-shared",
            workingDirectory: "/repo/parent",
          }),
        ],
      },
      {
        taskId: "B",
        agentSessions: [
          buildAgentSessionRecord({
            externalSessionId: "session-b",
            workingDirectory: "/repo/child",
          }),
        ],
      },
    ]);
    const tasksList = mock(async () => {
      if (isDeleted) {
        return deletedTasksList.promise;
      }
      return [{ ...makeTask("A", "open"), subtaskIds: ["B"] }, makeTask("B", "open")];
    });
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskDelete: host.taskDelete,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.taskDelete = taskDelete;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          agentSessionReadPort: {
            agentSessionsList: async () => {
              throw new Error("Exact session reads are not expected during deletion cleanup.");
            },
            agentSessionsListForTasks,
          },
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      const storage = createMemoryStorage();
      setAgentChatDraftStorageForTests(storage);
      const parentDraftIdentity = createDraftIdentity("session-shared", "/repo/parent");
      const childDraftIdentity = createDraftIdentity("session-b", "/repo/child");
      const unrelatedDraftIdentity = createDraftIdentity("session-shared", "/repo/unrelated");
      writeTestDraft(storage, parentDraftIdentity, "parent draft");
      writeTestDraft(storage, childDraftIdentity, "child draft");
      writeTestDraft(storage, unrelatedDraftIdentity, "unrelated draft");

      queryClient.setQueryData(taskQueryKeys.repoData("/repo", 1), {
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
      await harness.waitFor(() => latest?.tasks.length === 2);
      const operations = latest as ReturnType<typeof useTaskOperations> | null;
      if (!operations) {
        throw new Error("Hook not mounted");
      }
      deletePromise = operations.deleteTask("A", true);
      await taskDeleted.promise;

      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "A")),
      ).toEqual([
        buildAgentSessionRecord({
          externalSessionId: "session-shared",
          workingDirectory: "/repo/parent",
        }),
      ]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list("/repo", "B")),
      ).toEqual([
        buildAgentSessionRecord({
          externalSessionId: "session-b",
          workingDirectory: "/repo/child",
        }),
      ]);

      deletedTasksList.resolve([]);
      await deletePromise;

      await harness.waitFor(
        () =>
          queryClient.getQueryData<{ tasks: TaskCard[]; runs: RunSummary[] }>(
            taskQueryKeys.repoData("/repo", 1),
          )?.tasks.length === 0,
        1000,
      );

      expect(taskDelete).toHaveBeenCalledWith("/repo", "A", true);
      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A", "B"]);
      expect(storage.getItem(toAgentChatDraftStorageKey(parentDraftIdentity))).toBeNull();
      expect(storage.getItem(toAgentChatDraftStorageKey(childDraftIdentity))).toBeNull();
      expect(storage.getItem(toAgentChatDraftStorageKey(unrelatedDraftIdentity))).not.toBeNull();
      expect(queryClient.getQueryData(documentQueryKeys.spec("/repo", "A"))).toBeUndefined();
      expect(queryClient.getQueryData(documentQueryKeys.plan("/repo", "B"))).toBeUndefined();
      expect(queryClient.getQueryData(agentSessionQueryKeys.list("/repo", "A"))).toBeUndefined();
      expect(queryClient.getQueryData(agentSessionQueryKeys.list("/repo", "B"))).toBeUndefined();
    } finally {
      deletedTasksList.resolve([]);
      await deletePromise?.catch(() => undefined);
      await harness.unmount();
      host.taskDelete = original.taskDelete;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("deleteTask leaves chat drafts intact when the host deletion fails", async () => {
    const taskDelete = mock(async () => {
      throw new Error("delete failed");
    });
    const agentSessionsListForTasks = mock(async () => [
      {
        taskId: "A",
        agentSessions: [buildAgentSessionRecord({ externalSessionId: "session-a" })],
      },
    ]);
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      taskDelete: host.taskDelete,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.taskDelete = taskDelete;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const storage = createMemoryStorage();
    setAgentChatDraftStorageForTests(storage);
    const draftIdentity = createDraftIdentity("session-a");
    writeTestDraft(storage, draftIdentity, "parent draft");

    const harness = createHookHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      await expect(
        harness.run(async (value) => {
          await value.deleteTask("A");
        }),
      ).rejects.toThrow("delete failed");

      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A"]);
      expect(storage.getItem(toAgentChatDraftStorageKey(draftIdentity))).not.toBeNull();
    } finally {
      await harness.unmount();
      host.taskDelete = original.taskDelete;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("deleteTask reports chat draft cleanup storage failures without blocking host deletion", async () => {
    let isDeleted = false;
    const taskDelete = mock(async () => {
      isDeleted = true;
      return { ok: true };
    });
    const agentSessionsListForTasks = mock(async () => [
      {
        taskId: "A",
        agentSessions: [buildAgentSessionRecord({ externalSessionId: "session-a" })],
      },
    ]);
    const tasksList = mock(async () => (isDeleted ? [] : [makeTask("A", "open")]));
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      taskDelete: host.taskDelete,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.taskDelete = taskDelete;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const storage = createMemoryStorage({
      removeItem: () => {
        throw new Error("storage remove failed");
      },
    });
    setAgentChatDraftStorageForTests(storage);
    const draftIdentity = createDraftIdentity("session-a");
    writeTestDraft(storage, draftIdentity, "parent draft");

    const harness = createHookHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      await harness.run(async (value) => {
        await value.deleteTask("A");
      });

      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A"]);
      expect(taskDelete).toHaveBeenCalledWith("/repo", "A", false);
      expect(toastError).toHaveBeenCalledWith("Task updated, but chat draft cleanup failed", {
        description: "Failed to clean 1 chat draft storage key(s).",
      });
    } finally {
      await harness.unmount();
      host.taskDelete = original.taskDelete;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("deleteTask reports cleanup target lookup failure after host deletion succeeds", async () => {
    const taskDelete = mock(async () => {
      return { ok: true };
    });
    const agentSessionsListForTasks = mock(async () => {
      throw new Error("session lookup failed");
    });
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      taskDelete: host.taskDelete,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.taskDelete = taskDelete;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      await harness.run(async (value) => {
        await value.deleteTask("A");
      });

      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A"]);
      expect(taskDelete).toHaveBeenCalledWith("/repo", "A", false);
      expect(toastError).toHaveBeenCalledWith("Task updated, but chat draft cleanup failed", {
        description: "session lookup failed",
      });
    } finally {
      await harness.unmount();
      host.taskDelete = original.taskDelete;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("close and approval completion routes report cleanup lookup failures after host mutation succeeds", async () => {
    const taskClose = mock(async () => makeTask("A", "closed"));
    const humanApprove = mock(async () => makeTask("A", "closed"));
    const taskTransition = mock(async () => makeTask("A", "closed"));
    const agentSessionsListForTasks = mock(async () => {
      throw new Error("session lookup failed");
    });
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      taskClose: host.taskClose,
      humanApprove: host.humanApprove,
      taskTransition: host.taskTransition,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.taskClose = taskClose;
    host.humanApprove = humanApprove;
    host.taskTransition = taskTransition;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks[0]?.id === "A");

      await harness.run(async (value) => {
        await value.closeTask("A");
      });
      await harness.run(async (value) => {
        await value.humanApproveTask("A");
      });
      await harness.run(async (value) => {
        await value.transitionTask("A", "closed");
      });

      expect(agentSessionsListForTasks).toHaveBeenCalledTimes(3);
      expect(taskClose).toHaveBeenCalledWith("/repo", "A");
      expect(humanApprove).toHaveBeenCalledWith("/repo", "A");
      expect(taskTransition).toHaveBeenCalledWith("/repo", "A", "closed", undefined);
      expect(toastError).toHaveBeenCalledTimes(3);
      expect(toastError).toHaveBeenCalledWith("Task updated, but chat draft cleanup failed", {
        description: "session lookup failed",
      });
    } finally {
      await harness.unmount();
      host.taskClose = original.taskClose;
      host.humanApprove = original.humanApprove;
      host.taskTransition = original.taskTransition;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
    }
  });

  test("closeTask calls the host close route and refreshes the task", async () => {
    let isClosed = false;
    const taskClose = mock(async () => {
      isClosed = true;
      return makeTask("A", "closed");
    });
    const agentSessionsListForTasks = mock(async () => [
      {
        taskId: "A",
        agentSessions: [buildAgentSessionRecord({ externalSessionId: "session-a" })],
      },
    ]);
    const tasksList = mock(async () => [makeTask("A", isClosed ? "closed" : "in_progress")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskClose: host.taskClose,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.taskClose = taskClose;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const queryClient = createQueryClient();
    let latest: ReturnType<typeof useTaskOperations> | null = null;

    const Harness = ({ args }: { args: HookArgs }) => {
      latest = useTaskOperations(normalizeHookArgs(args));
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const harness = createSharedHookHarness(
      Harness,
      {
        args: {
          activeWorkspace: createActiveWorkspace("/repo"),
          agentSessionReadPort: {
            agentSessionsList: async () => [],
            agentSessionsListForTasks,
          },
          refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
        },
      },
      { wrapper },
    );

    try {
      const storage = createMemoryStorage();
      setAgentChatDraftStorageForTests(storage);
      const draftIdentity = createDraftIdentity("session-a");
      writeTestDraft(storage, draftIdentity, "close draft");

      await harness.mount();
      await harness.waitFor(() => latest?.tasks[0]?.status === "in_progress");
      await harness.run(async () => {
        if (!latest) {
          throw new Error("Hook not mounted");
        }

        await latest.closeTask("A");
      });

      await harness.waitFor(
        () =>
          queryClient.getQueryData<{ tasks: TaskCard[]; runs: RunSummary[] }>(
            taskQueryKeys.repoData("/repo", 1),
          )?.tasks[0]?.status === "closed",
        1000,
      );

      expect(taskClose).toHaveBeenCalledWith("/repo", "A");
      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A"]);
      expect(storage.getItem(toAgentChatDraftStorageKey(draftIdentity))).toBeNull();
    } finally {
      await harness.unmount();
      host.taskClose = original.taskClose;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
      expect(harness.getLatest().tasks[0]?.pullRequest?.number).toBe(17);
      expect(toastSuccess).toHaveBeenCalledWith("Pull request linked", {
        description: "PR #17",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
    }
  });

  test("syncPullRequests ignores merged pull request results after repo switches", async () => {
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
    const detection = createDeferred<{
      outcome: "merged";
      pullRequest: typeof mergedPullRequest;
    }>();
    const taskPullRequestDetect = mock(async () => detection.promise);
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);

      let syncPromise: Promise<void> | null = null;
      await harness.run((value) => {
        syncPromise = value.syncPullRequests("A");
      });

      await harness.updateArgs({
        activeRepo: "/repo-b",
        refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
      });

      await harness.run(async () => {
        detection.resolve({ outcome: "merged", pullRequest: mergedPullRequest });
        await syncPromise;
      });

      expect(taskPullRequestDetect).toHaveBeenCalledWith("/repo-a", "A");
      expect(harness.getLatest().pendingMergedPullRequest).toBeNull();
      expect(harness.getLatest().detectingPullRequestTaskId).toBeNull();
    } finally {
      detection.resolve({ outcome: "merged", pullRequest: mergedPullRequest });
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
    const agentSessionsListForTasks = mock(async () => [
      {
        taskId: "A",
        agentSessions: [buildAgentSessionRecord({ externalSessionId: "session-a" })],
      },
    ]);
    const tasksList = mock(async () => [makeTask("A", "closed")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.taskPullRequestLinkMerged = taskPullRequestLinkMerged;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      const storage = createMemoryStorage();
      setAgentChatDraftStorageForTests(storage);
      const draftIdentity = createDraftIdentity("session-a");
      writeTestDraft(storage, draftIdentity, "merged draft");

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
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A"]);
      expect(storage.getItem(toAgentChatDraftStorageKey(draftIdentity))).toBeNull();
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
      legacyHost.runsList = original.runsList;
      toast.success = originalToastSuccess;
    }
  });

  test("linkMergedPullRequest reports cleanup lookup failure after merged-link mutation succeeds", async () => {
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
    const taskPullRequestDetect = mock(async () => ({
      outcome: "merged" as const,
      pullRequest: mergedPullRequest,
    }));
    const taskPullRequestLinkMerged = mock(async () => makeTask("A", "closed"));
    const agentSessionsListForTasks = mock(async () => {
      throw new Error("session lookup failed");
    });
    const tasksList = mock(async () => [makeTask("A", "human_review")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);
    const toastError = mock((_message: string, _options?: { description?: string }) => "");

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
      toastError: toast.error,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.taskPullRequestLinkMerged = taskPullRequestLinkMerged;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      await harness.run(async (value) => {
        await value.syncPullRequests("A");
      });
      await harness.run(async (value) => {
        await value.linkMergedPullRequest();
      });

      expect(agentSessionsListForTasks).toHaveBeenCalledWith("/repo", ["A"]);
      expect(taskPullRequestLinkMerged).toHaveBeenCalledWith("/repo", "A", mergedPullRequest);
      expect(toastError).toHaveBeenCalledWith("Task updated, but chat draft cleanup failed", {
        description: "session lookup failed",
      });
      expect(harness.getLatest().pendingMergedPullRequest).toBeNull();
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.taskPullRequestLinkMerged = original.taskPullRequestLinkMerged;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
      toast.error = original.toastError;
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
    const agentSessionsListForTasks = mock(async () => [{ taskId: "A", agentSessions: [] }]);
    const tasksList = mock(async () => [makeTask("A", currentStatus)]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      taskPullRequestDetect: host.taskPullRequestDetect,
      taskPullRequestLinkMerged: host.taskPullRequestLinkMerged,
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.taskPullRequestLinkMerged = taskPullRequestLinkMerged;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      agentSessionReadPort: {
        agentSessionsList: async () => [],
        agentSessionsListForTasks,
      },
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
    } finally {
      await harness.unmount();
      host.taskPullRequestDetect = original.taskPullRequestDetect;
      host.taskPullRequestLinkMerged = original.taskPullRequestLinkMerged;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });

  test("linkMergedPullRequest surfaces an actionable error when merged PR state is missing", async () => {
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const originalToastWarning = toast.warning;
    const toastWarning = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { warning: typeof toast.warning }).warning =
      toastWarning as unknown as typeof toast.warning;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestDetect = taskPullRequestDetect;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
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
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;
    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const originalToastSuccess = toast.success;
    const toastSuccess = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.unlinkPullRequest("A");
      });

      expect(taskPullRequestUnlink).toHaveBeenCalledWith("/repo", "A");
      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
      expect(harness.getLatest().tasks[0]?.pullRequest).toBeUndefined();
      expect(toastSuccess).toHaveBeenCalledWith("Pull request unlinked", {
        description: "A",
      });
    } finally {
      await harness.unmount();
      host.taskPullRequestUnlink = original.taskPullRequestUnlink;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskPullRequestUnlink = taskPullRequestUnlink;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskCreate = taskCreate;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
      legacyHost.runsList = original.runsList;
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
      runsList: legacyHost.runsList,
    };
    host.taskCreate = taskCreate;
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createTaskAndKanbanHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
      expect(
        tasksList.mock.calls.some((call) => {
          const args = call as unknown[];
          return args[0] === "/repo" && args[1] === 1;
        }),
      ).toBe(true);
    } finally {
      await harness.unmount();
      host.taskCreate = original.taskCreate;
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
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
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
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

  test("refreshTasks does not gate task reload on diagnostics state", async () => {
    const tasksList = mock(async () => [makeTask("A", "open")]);
    const runsList = mock(async (): Promise<RunSummary[]> => []);

    const original = {
      tasksList: host.tasksList,
      runsList: legacyHost.runsList,
    };
    host.tasksList = tasksList;
    legacyHost.runsList = runsList;

    const harness = createHookHarness({
      activeRepo: "/repo",
      refreshTaskStoreCheckForRepo: async (): Promise<TaskStoreCheck> => makeTaskStoreCheck(),
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => value.tasks.length === 1);
      tasksList.mockClear();
      runsList.mockClear();
      await harness.run(async (value) => {
        await value.refreshTasks();
      });

      expect(tasksList).toHaveBeenCalledWith("/repo", 1);
      expect(runsList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.tasksList = original.tasksList;
      legacyHost.runsList = original.runsList;
    }
  });
});
