import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  AgentSessionLiveSnapshot,
  AgentSessionLiveEnvelope,
  NotificationOccurrence,
  TaskCard,
} from "@openducktor/contracts";
import { CancelledError, useQueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createTaskViewSync } from "@/state/queries/task-view-sync";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { readCachedAgentSessionAssociation } from "@/state/queries/agent-session-association";
import { taskQueryKeys, type RepoTaskData } from "@/state/queries/tasks";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createDeferred, createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createNotificationTaskObserver as createTaskObserver } from "./notification-task-observer";
import { createNotificationWorkspaceObserver } from "./notification-workspace-observer";

type AgentSessionLiveSnapshotEnvelope = Extract<AgentSessionLiveEnvelope, { type: "snapshot" }>;

const renderIsolatedQueryClient = () =>
  renderHook(() => useQueryClient(), { wrapper: IsolatedQueryWrapper });

const createNotificationTaskObserver = (
  options: Omit<Parameters<typeof createTaskObserver>[0], "resolveSessionAssociation">,
  queryClient = renderIsolatedQueryClient().result.current,
) => {
  return createTaskObserver({
    ...options,
    resolveSessionAssociation: (ref) => readCachedAgentSessionAssociation(queryClient, ref),
    loadSessionRecords: async (repoPath, taskIds) => {
      const records = await options.loadSessionRecords(repoPath, taskIds);
      for (const taskId of taskIds)
        queryClient.setQueryData(
          agentSessionQueryKeys.list(repoPath, taskId),
          records[taskId] ?? [],
        );
      return records;
    },
  });
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const liveSnapshot = (pendingRequestIds: string[]): AgentSessionLiveSnapshotEnvelope => ({
  type: "snapshot",
  repoPath: "/repo-a",
  sessions: [
    {
      ref: {
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      },
      activity: "idle",
      title: "Builder session",
      startedAt: "2026-08-31T10:00:00.000Z",
      pendingApprovals: pendingRequestIds.map((requestId) => ({
        requestId,
        requestType: "permission_grant" as const,
        title: "Read",
      })),
      pendingQuestions: [],
      contextUsage: null,
      executionEpisodeId: "episode-1",
    },
  ],
});

const workflowSessionRecord: AgentSessionRecord = {
  externalSessionId: "session-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a/worktree",
  startedAt: "2026-08-31T10:00:00.000Z",
  selectedModel: null,
};

const loadWorkflowSessionRecords = async (
  _repoPath: string,
  taskIds: string[],
): Promise<Record<string, AgentSessionRecord[]>> =>
  Object.fromEntries(
    taskIds.map((taskId) => [taskId, taskId === "task-1" ? [workflowSessionRecord] : []]),
  );

const liveUpsert = (pendingRequestIds: string[]): AgentSessionLiveEnvelope => {
  const session = liveSnapshot(pendingRequestIds).sessions[0];
  if (!session) throw new Error("The live session fixture is missing.");
  return { type: "session_upsert", session };
};

test.each([
  ["tasks", "permission"],
  ["tasks", "question"],
  ["sessions", "permission"],
  ["sessions", "question"],
] as const)(
  "keeps a live %s-baseline %s request until associations are ready",
  async (source, kind) => {
    const baseline = createDeferred<void>();
    const published: NotificationOccurrence[] = [];
    let receive = (_envelope: AgentSessionLiveEnvelope) => {};
    const pendingSnapshot = (ids: string[]): AgentSessionLiveSnapshotEnvelope => {
      const envelope = liveSnapshot(kind === "permission" ? ids : []);
      const session = envelope.sessions[0];
      if (!session) throw new Error("Missing session fixture.");
      if (kind === "question")
        session.pendingQuestions = ids.map((requestId) => ({
          requestId,
          questions: [
            {
              header: "Provider",
              question: "Which provider?",
              options: [],
              multiple: false,
              custom: true,
            },
          ],
        }));
      return envelope;
    };
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => {
        if (source === "tasks") await baseline.promise;
        return [createTaskCardFixture({ id: "task-1" })];
      },
      loadSessionRecords: async (...args) => {
        if (source === "sessions") await baseline.promise;
        return loadWorkflowSessionRecords(...args);
      },
      publish: () => {},
      onFailure: (failure) => {
        throw failure.cause;
      },
    });
    const observer = createNotificationWorkspaceObserver({
      observe: async (_input, listener) => {
        receive = listener;
        listener(pendingSnapshot(["existing"]));
        return () => {};
      },
      taskObserver,
      publish: (occurrence) => published.push(occurrence),
      onFailure: (failure) => {
        throw failure.cause;
      },
    });
    const sync = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    await flush();
    const session = pendingSnapshot(["existing", "new"]).sessions[0];
    if (!session) throw new Error("Missing session fixture.");
    const event = { type: "session_upsert" as const, session };
    receive(event);
    receive(event);
    expect(published).toEqual([]);
    baseline.resolve();
    await sync;
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      kind: kind === "permission" ? "agent.permission_requested" : "agent.question_asked",
      task: { id: "task-1" },
      navigationTarget: { type: "pending_input", inputKind: kind, requestId: "new" },
    });
    receive(event);
    expect(published).toHaveLength(1);
    observer.dispose();
  },
);

test.each(["failure", "removed", "disposed"] as const)(
  "drops buffered live events after startup is %s",
  async (outcome) => {
    const baseline = createDeferred<TaskCard[]>();
    const published = mock(() => {});
    const stop = mock(() => {});
    const onFailure = mock(() => {});
    let receive = (_envelope: AgentSessionLiveEnvelope) => {};
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => baseline.promise,
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: () => {},
      onFailure,
    });
    const observer = createNotificationWorkspaceObserver({
      observe: async (_input, listener) => {
        receive = listener;
        listener(liveSnapshot([]));
        return stop;
      },
      taskObserver,
      publish: published,
      onFailure,
    });
    const sync = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    receive(liveUpsert(["new"]));
    await flush();
    if (outcome === "removed") await observer.syncWorkspaces([]);
    if (outcome === "disposed") observer.dispose();
    if (outcome === "failure") baseline.reject(new Error("Baseline failed"));
    else baseline.resolve([createTaskCardFixture({ id: "task-1" })]);
    await sync;
    receive(liveUpsert(["new", "later"]));
    expect(published).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
    observer.dispose();
  },
);

test.each(["tasks", "sessions"])(
  "recovers a failed %s baseline on the next workspace sync",
  async (source) => {
    let fail = true;
    const tasks = [createTaskCardFixture({ id: "task-1" })];
    const onFailure = mock(() => {});
    const observe = mock(async () => () => {});
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => {
        if (fail && source === "tasks") throw new Error("Read failed");
        return tasks;
      },
      loadSessionRecords: async () => {
        if (fail && source === "sessions") throw new Error("Read failed");
        return { "task-1": [workflowSessionRecord] };
      },
      publish: () => {},
      onFailure,
    });
    const observer = createNotificationWorkspaceObserver({
      observe,
      taskObserver,
      publish: () => {},
      onFailure,
    });
    const workspaces = [{ repoPath: "/repo-a", repositoryLabel: "Repo" }];
    await observer.syncWorkspaces(workspaces);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    fail = false;
    await observer.syncWorkspaces(workspaces);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(taskObserver.resolveTask("/repo-a", "task-1")?.id).toBe("task-1");
    observer.dispose();
  },
);

test("publishes a buffered request after effect replay and cancelled startup recovery", async () => {
  const queryClientHook = renderIsolatedQueryClient();
  const queryClient = queryClientHook.result.current;
  const firstReadStarted = createDeferred<void>();
  const firstRead = createDeferred<TaskCard[]>();
  let readCount = 0;
  const loadTasks = async (repoPath: string): Promise<TaskCard[]> => {
    const result = await queryClient.fetchQuery({
      queryKey: taskQueryKeys.repoData(repoPath),
      queryFn: async () => {
        readCount += 1;
        if (readCount === 1) {
          firstReadStarted.resolve();
          return { tasks: await firstRead.promise };
        }
        return { tasks: [createTaskCardFixture({ id: "task-1" })] };
      },
      staleTime: 0,
    });
    return result.tasks;
  };
  const onFailure = mock(() => {});
  const stop = mock(() => {});
  const published: NotificationOccurrence[] = [];
  let receive = (_envelope: AgentSessionLiveEnvelope) => {};
  const taskObserver = createNotificationTaskObserver(
    {
      loadTasks,
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: () => {},
      onFailure,
    },
    queryClient,
  );
  const observer = createNotificationWorkspaceObserver({
    observe: async (_input, listener) => {
      receive = listener;
      listener(liveSnapshot(["existing"]));
      return stop;
    },
    taskObserver,
    publish: (occurrence) => published.push(occurrence),
    onFailure,
  });

  try {
    await observer.syncWorkspaces([]);
    observer.dispose();

    const startup = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    await firstReadStarted.promise;
    await queryClient.cancelQueries(
      { queryKey: taskQueryKeys.repoData("/repo-a"), exact: true },
      { silent: true },
    );
    await startup;

    expect(onFailure).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    receive(liveUpsert(["existing", "new"]));
    expect(published).toEqual([]);

    await taskObserver.sink.onSnapshot();

    expect(published).toMatchObject([
      {
        kind: "agent.permission_requested",
        task: { id: "task-1" },
      },
    ]);
  } finally {
    firstRead.resolve([]);
    observer.dispose();
    queryClientHook.unmount();
  }
  expect(stop).toHaveBeenCalledTimes(1);
});

test("stops a cancelled startup observation when baseline recovery fails", async () => {
  const queryClientHook = renderIsolatedQueryClient();
  const queryClient = queryClientHook.result.current;
  let readCount = 0;
  const recoveryError = new Error("sessions unavailable");
  const onFailure = mock(() => {});
  const stop = mock(() => {});
  const published: NotificationOccurrence[] = [];
  let receive = (_envelope: AgentSessionLiveEnvelope) => {};
  const taskObserver = createNotificationTaskObserver(
    {
      loadTasks: async () => {
        readCount += 1;
        if (readCount === 1) throw new CancelledError();
        if (readCount === 2) throw recoveryError;
        return [createTaskCardFixture({ id: "task-1" })];
      },
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: () => {},
      onFailure,
    },
    queryClient,
  );
  const observer = createNotificationWorkspaceObserver({
    observe: async (_input, listener) => {
      receive = listener;
      listener(liveSnapshot(["existing"]));
      return stop;
    },
    taskObserver,
    publish: (occurrence) => published.push(occurrence),
    onFailure,
  });

  try {
    await observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    receive(liveUpsert(["existing", "new"]));

    await taskObserver.sink.onSnapshot();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      source: "task",
      cause: recoveryError,
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(published).toEqual([]);

    await taskObserver.sink.onSnapshot();
    expect(published).toEqual([]);
  } finally {
    observer.dispose();
    queryClientHook.unmount();
  }
});

test("keeps a newer recovery observation when an older baseline fails", async () => {
  const olderRecovery = createDeferred<TaskCard[]>();
  const olderRecoveryStarted = createDeferred<void>();
  const newerRecovery = createDeferred<TaskCard[]>();
  const newerRecoveryStarted = createDeferred<void>();
  const staleFailure = new Error("stale recovery failed");
  const tasks = [createTaskCardFixture({ id: "task-1" })];
  let readCount = 0;
  const taskFailure = mock(() => {});
  const taskObserver = createNotificationTaskObserver({
    loadTasks: async () => {
      readCount += 1;
      if (readCount === 1) throw new CancelledError();
      if (readCount === 2) {
        olderRecoveryStarted.resolve();
        return olderRecovery.promise;
      }
      newerRecoveryStarted.resolve();
      return newerRecovery.promise;
    },
    loadSessionRecords: loadWorkflowSessionRecords,
    publish: () => {},
    onFailure: taskFailure,
  });
  const stop = mock(() => {});
  const onFailure = mock(() => {});
  const published: NotificationOccurrence[] = [];
  let receive = (_envelope: AgentSessionLiveEnvelope) => {};
  const observer = createNotificationWorkspaceObserver({
    observe: async (_input, listener) => {
      receive = listener;
      listener(liveSnapshot(["existing"]));
      return stop;
    },
    taskObserver,
    publish: (occurrence) => published.push(occurrence),
    onFailure,
  });
  const workspaces = [{ repoPath: "/repo-a", repositoryLabel: "Repo A" }];

  try {
    await observer.syncWorkspaces(workspaces);
    const staleRefresh = taskObserver.sink.onSnapshot();
    await olderRecoveryStarted.promise;
    const currentRefresh = observer.syncWorkspaces(workspaces);
    await newerRecoveryStarted.promise;

    olderRecovery.reject(staleFailure);
    await staleRefresh;
    expect(stop).not.toHaveBeenCalled();
    expect(taskFailure).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    newerRecovery.resolve(tasks);
    await currentRefresh;
    receive(liveUpsert(["existing", "new"]));
    expect(published).toMatchObject([
      {
        kind: "agent.permission_requested",
        task: { id: "task-1" },
      },
    ]);
  } finally {
    olderRecovery.resolve(tasks);
    newerRecovery.resolve(tasks);
    observer.dispose();
  }
});

test("serializes a notification baseline with a manual task refresh", async () => {
  const queryClientHook = renderIsolatedQueryClient();
  const queryClient = queryClientHook.result.current;
  const firstReadStarted = createDeferred<void>();
  const firstRead = createDeferred<TaskCard[]>();
  const tasks = [createTaskCardFixture({ id: "task-1" })];
  let readCount = 0;
  const taskViewSync = createTaskViewSync({
    queryClient,
    ports: {
      listTasks: async () => {
        readCount += 1;
        if (readCount === 1) {
          firstReadStarted.resolve();
          return await firstRead.promise;
        }
        return tasks;
      },
      loadFreshDocument: async () => {
        throw new Error("Unexpected document read.");
      },
    },
  });
  const onFailure = mock(() => {});
  const published: NotificationOccurrence[] = [];
  let receive = (_envelope: AgentSessionLiveEnvelope) => {};
  const taskObserver = createNotificationTaskObserver(
    {
      loadTasks: async (repoPath) => {
        await taskViewSync.loadWorkspace(repoPath, { forceFresh: true });
        const taskData = queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData(repoPath));
        if (!taskData) throw new Error("Task notification data is unavailable.");
        return taskData.tasks;
      },
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: () => {},
      onFailure,
    },
    queryClient,
  );
  const observer = createNotificationWorkspaceObserver({
    observe: async (_input, listener) => {
      receive = listener;
      listener(liveSnapshot(["existing"]));
      return () => {};
    },
    taskObserver,
    publish: (occurrence) => published.push(occurrence),
    onFailure,
  });

  try {
    const startup = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    await firstReadStarted.promise;
    const manualRefresh = taskViewSync.refreshManually("/repo-a");
    await flush();
    expect(readCount).toBe(1);

    firstRead.resolve(tasks);
    await Promise.all([startup, manualRefresh]);

    receive(liveUpsert(["existing", "new"]));
    expect(onFailure).not.toHaveBeenCalled();
    expect(published).toMatchObject([
      {
        kind: "agent.permission_requested",
        task: { id: "task-1" },
      },
    ]);
  } finally {
    firstRead.resolve(tasks);
    observer.dispose();
    queryClientHook.unmount();
  }
});

test("reads new ownership from Query before the queued task notification sink runs", async () => {
  const queryClientHook = renderIsolatedQueryClient();
  const queryClient = queryClientHook.result.current;
  const published: NotificationOccurrence[] = [];
  const taskObserver = createTaskObserver({
    loadTasks: async () => [createTaskCardFixture({ id: "task-1" })],
    loadSessionRecords: async () => ({}),
    resolveSessionAssociation: (ref) => readCachedAgentSessionAssociation(queryClient, ref),
    publish: () => {},
    onFailure: () => {},
  });
  let listener = (_envelope: AgentSessionLiveEnvelope) => {};
  const observer = createNotificationWorkspaceObserver({
    observe: async (_input, receive) => {
      listener = receive;
      return () => {};
    },
    taskObserver,
    publish: (occurrence) => published.push(occurrence),
    onFailure: () => {},
  });
  try {
    await observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo" }]);
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo-a", "task-1"), [
      workflowSessionRecord,
    ]);
    listener(liveSnapshot(["existing"]));
    expect(published).toEqual([]);
    listener(liveUpsert(["existing", "new"]));
    expect(published.map((item) => item.kind)).toEqual(["agent.permission_requested"]);
  } finally {
    observer.dispose();
    queryClientHook.unmount();
  }
});

describe("all-workspace notification observation", () => {
  test("projects queued changes after the initial baseline without a second read", async () => {
    const baseline = createDeferred<TaskCard[]>();
    const loadTasks = mock(async () => baseline.promise);
    const published: NotificationOccurrence[] = [];
    const observer = createNotificationTaskObserver({
      loadTasks,
      loadSessionRecords: async () => ({}),
      publish: (occurrence) => published.push(occurrence),
      onFailure: (failure) => {
        throw failure.cause;
      },
    });
    const sync = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    const changes = [
      { eventId: "blocked", previousStatus: "in_progress", status: "blocked" },
      { eventId: "closed", previousStatus: "blocked", status: "closed" },
    ] as const;
    const events = changes.map(({ eventId, previousStatus, status }) => ({
      kind: "tasks_updated" as const,
      repoPath: "/repo-a",
      eventId,
      taskIds: ["task-1"],
      removedTaskIds: [],
      taskSnapshots: [{ id: "task-1", title: "Task", status }],
      statusChanges: [{ previousStatus, task: { id: "task-1", title: "Task", status } }],
      emittedAt: "2026-09-06T10:00:00.000Z",
    }));
    const pending = events.map((event) => observer.sink.onChange(event));
    await flush();
    expect(loadTasks).toHaveBeenCalledTimes(1);
    expect(published).toEqual([]);
    baseline.resolve([createTaskCardFixture({ id: "task-1", status: "closed" })]);
    await Promise.all([sync, ...pending]);
    for (const event of events) await observer.sink.onChange(event);
    expect(published.map((occurrence) => occurrence.kind)).toEqual([
      "workflow.blocked",
      "workflow.closed",
    ]);
    expect(loadTasks).toHaveBeenCalledTimes(1);
  });

  test("drops waiting changes when the workspace is removed and registered again", async () => {
    const baseline = createDeferred<TaskCard[]>();
    const published = mock(() => {});
    const loadTasks = mock(async () => baseline.promise);
    const observer = createNotificationTaskObserver({
      loadTasks,
      loadSessionRecords: async () => ({}),
      publish: published,
      onFailure: (failure) => {
        throw failure.cause;
      },
    });
    const workspace = { repoPath: "/repo-a", repositoryLabel: "Repo A" };
    const firstSync = observer.syncWorkspaces([workspace]);
    const pending = observer.sink.onChange({
      kind: "tasks_updated",
      repoPath: workspace.repoPath,
      eventId: "old-change",
      taskIds: ["task-1"],
      removedTaskIds: [],
      taskSnapshots: [{ id: "task-1", title: "Old task", status: "closed" }],
      statusChanges: [
        { previousStatus: "blocked", task: { id: "task-1", title: "Old task", status: "closed" } },
      ],
      emittedAt: "2026-09-06T10:00:00.000Z",
    });
    await observer.syncWorkspaces([]);
    loadTasks.mockImplementation(async () => []);
    await observer.syncWorkspaces([workspace]);
    baseline.resolve([createTaskCardFixture({ id: "task-1", title: "Old task" })]);
    await Promise.all([firstSync, pending]);
    expect(published).not.toHaveBeenCalled();
    expect(observer.resolveTask(workspace.repoPath, "task-1")).toBeNull();
  });

  test("reports a failed initial baseline without silently consuming a waiting change", async () => {
    const baseline = createDeferred<TaskCard[]>();
    const onFailure = mock(() => {});
    const observer = createNotificationTaskObserver({
      loadTasks: async () => baseline.promise,
      loadSessionRecords: async () => ({}),
      publish: () => {},
      onFailure,
    });
    const sync = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    const pending = observer.sink.onChange({
      kind: "tasks_updated",
      repoPath: "/repo-a",
      eventId: "waiting",
      taskIds: ["task-1"],
      removedTaskIds: [],
      taskSnapshots: [],
      statusChanges: [],
      emittedAt: "2026-09-06T10:00:00.000Z",
    });
    baseline.reject(new Error("Task read failed"));
    await sync;
    await expect(pending).rejects.toThrow(
      "Task notification baseline is unavailable. Reload to reconnect.",
    );
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ cause: expect.objectContaining({ message: "Task read failed" }) }),
    );
  });

  test("does not restore a workspace removed while its baseline is loading", async () => {
    let finishBaseline: ((tasks: TaskCard[]) => void) | undefined;
    const baseline = new Promise<TaskCard[]>((resolve) => {
      finishBaseline = resolve;
    });
    const stop = mock(() => {});
    const observe = mock(async () => stop);
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => baseline,
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: () => {},
      onFailure: () => {},
    });
    const observer = createNotificationWorkspaceObserver({
      observe,
      taskObserver,
      publish: () => {},
      onFailure: () => {},
    });

    const add = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    await flush();
    await observer.syncWorkspaces([]);
    finishBaseline?.([createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })]);
    await add;

    expect(observe).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(taskObserver.resolveTask("/repo-a", "task-1")).toBeNull();
  });

  test("opens one live subscription while concurrent syncs wait for the baseline", async () => {
    let finishBaseline: ((tasks: TaskCard[]) => void) | undefined;
    const baseline = new Promise<TaskCard[]>((resolve) => {
      finishBaseline = resolve;
    });
    const observe = mock(async () => () => {});
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => baseline,
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: () => {},
      onFailure: () => {},
    });
    const observer = createNotificationWorkspaceObserver({
      observe,
      taskObserver,
      publish: () => {},
      onFailure: () => {},
    });
    const workspaces = [{ repoPath: "/repo-a", repositoryLabel: "Repo A" }];

    const firstSync = observer.syncWorkspaces(workspaces);
    await flush();
    const secondSync = observer.syncWorkspaces(workspaces);
    await flush();

    expect(observe).toHaveBeenCalledTimes(1);
    finishBaseline?.([]);
    await Promise.all([firstSync, secondSync]);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  test("baselines every added workspace, observes inactive repos, and stops removed repos", async () => {
    const tasks = new Map<string, TaskCard[]>([
      ["/repo-a", [createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })]],
      ["/repo-b", [createTaskCardFixture({ id: "task-2", title: "Task B", status: "open" })]],
    ]);
    const published: NotificationOccurrence[] = [];
    const failures: unknown[] = [];
    const listeners = new Map<string, (envelope: AgentSessionLiveEnvelope) => void>();
    const stopped: string[] = [];
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async (repoPath) => tasks.get(repoPath) ?? [],
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: (occurrence) => published.push(occurrence),
      onFailure: (failure) => failures.push(failure),
    });
    const observer = createNotificationWorkspaceObserver({
      observe: mock(async ({ repoPath }, listener) => {
        listeners.set(repoPath, listener);
        return () => {
          listeners.delete(repoPath);
          stopped.push(repoPath);
        };
      }),
      taskObserver,
      publish: (occurrence) => published.push(occurrence),
      onFailure: (failure) => failures.push(failure),
    });

    await observer.syncWorkspaces([
      { repoPath: "/repo-a", repositoryLabel: "Repo A" },
      { repoPath: "/repo-b", repositoryLabel: "Repo B" },
    ]);
    await flush();
    listeners.get("/repo-a")?.(liveSnapshot(["existing"]));
    listeners.get("/repo-a")?.(liveUpsert(["existing", "new"]));

    expect(published).toMatchObject([
      {
        kind: "agent.permission_requested",
        repositoryLabel: "Repo A",
        task: { id: "task-1", title: "Task A" },
      },
    ]);

    await observer.syncWorkspaces([{ repoPath: "/repo-b", repositoryLabel: "Repo B" }]);
    expect(stopped).toEqual(["/repo-a"]);
    expect(listeners.has("/repo-a")).toBe(false);
    expect(failures).toEqual([]);
    observer.dispose();
    expect(stopped).toEqual(["/repo-a", "/repo-b"]);
  });

  test("refreshes the changed repo and publishes one workflow transition", async () => {
    let currentTasks = [createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })];
    const published: NotificationOccurrence[] = [];
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => currentTasks,
      loadSessionRecords: async () => ({}),
      publish: (occurrence) => published.push(occurrence),
      onFailure: () => {},
    });
    await taskObserver.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    currentTasks = [createTaskCardFixture({ id: "task-1", title: "Task A", status: "spec_ready" })];

    await taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-1",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      statusChanges: [
        { previousStatus: "open", task: { id: "task-1", title: "Task A", status: "spec_ready" } },
      ],
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "spec_ready" }],
      emittedAt: "2026-08-31T10:01:00.000Z",
    });

    expect(published).toMatchObject([
      {
        kind: "workflow.spec_ready",
        occurrenceId: "workflow.spec_ready:/repo-a:task-1:event-1:0",
      },
    ]);
  });

  test("updates workflow ownership from task session records", async () => {
    const tasks = [createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })];
    let records = { "task-1": [workflowSessionRecord] };
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => tasks,
      loadSessionRecords: async () => records,
      publish: () => {},
      onFailure: () => {},
    });
    await taskObserver.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);

    expect(
      taskObserver.resolveSessionAssociation({ repoPath: "/repo-a", ...workflowSessionRecord }),
    ).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });

    records = { "task-1": [] };
    await taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-session-removed",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      statusChanges: [],
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "open" }],
      emittedAt: "2026-08-31T10:01:00.000Z",
    });

    expect(
      taskObserver.resolveSessionAssociation({ repoPath: "/repo-a", ...workflowSessionRecord }),
    ).toBeNull();
  });

  test("publishes each event-bound workflow transition when task reads see a newer state", async () => {
    let currentTasks = [createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })];
    const published: NotificationOccurrence[] = [];
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => currentTasks,
      loadSessionRecords: async () => ({}),
      publish: (occurrence) => published.push(occurrence),
      onFailure: () => {},
    });
    await taskObserver.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    currentTasks = [
      createTaskCardFixture({ id: "task-1", title: "Task A", status: "ready_for_dev" }),
    ];

    await taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-spec-ready",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      statusChanges: [
        { previousStatus: "open", task: { id: "task-1", title: "Task A", status: "spec_ready" } },
      ],
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "spec_ready" }],
      emittedAt: "2026-08-31T10:01:00.000Z",
    });
    await taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-ready-for-dev",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      statusChanges: [
        {
          previousStatus: "spec_ready",
          task: { id: "task-1", title: "Task A", status: "ready_for_dev" },
        },
      ],
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "ready_for_dev" }],
      emittedAt: "2026-08-31T10:02:00.000Z",
    });

    expect(published.map(({ kind, occurrenceId }) => ({ kind, occurrenceId }))).toEqual([
      {
        kind: "workflow.spec_ready",
        occurrenceId: "workflow.spec_ready:/repo-a:task-1:event-spec-ready:0",
      },
      {
        kind: "workflow.ready_for_dev",
        occurrenceId: "workflow.ready_for_dev:/repo-a:task-1:event-ready-for-dev:0",
      },
    ]);
  });
});

test("starts observation again after a failed registration on the next workspace sync", async () => {
  const onFailure = mock(() => {});
  const stop = mock(() => {});
  const observe = mock(async () => {
    if (observe.mock.calls.length === 1) throw new Error("Subscription failed");
    return stop;
  });
  const taskObserver = createNotificationTaskObserver({
    loadTasks: async () => [],
    loadSessionRecords: async () => ({}),
    publish: () => {},
    onFailure,
  });
  const observer = createNotificationWorkspaceObserver({
    observe,
    taskObserver,
    publish: () => {},
    onFailure,
  });
  const workspaces = [{ repoPath: "/repo", repositoryLabel: "Repo" }];
  await observer.syncWorkspaces(workspaces);
  await Promise.resolve();
  await Promise.resolve();
  expect(onFailure).toHaveBeenCalledTimes(1);
  await observer.syncWorkspaces(workspaces);
  await Promise.resolve();
  expect(observe).toHaveBeenCalledTimes(2);
  observer.dispose();
  expect(stop).toHaveBeenCalledTimes(1);
});

test("retains full-identity workflow associations when the next session read fails", async () => {
  const onFailure = mock(() => {});
  let fail = false;
  const tasks = [createTaskCardFixture({ id: "task-1", status: "open" })];
  const taskObserver = createNotificationTaskObserver({
    loadTasks: async () => tasks,
    loadSessionRecords: async () => {
      if (fail) throw new Error("Session read failed");
      return { "task-1": [workflowSessionRecord] };
    },
    publish: () => {},
    onFailure,
  });
  const workspaces = [{ repoPath: "/repo-a", repositoryLabel: "Repo" }];
  await taskObserver.syncWorkspaces(workspaces);
  fail = true;
  await expect(
    taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-failed-read",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      statusChanges: [],
      taskSnapshots: [{ id: "task-1", title: "Task", status: "spec_ready" }],
      emittedAt: "2026-09-05T10:00:00.000Z",
    }),
  ).rejects.toThrow("Session read failed");
  const ref = { repoPath: "/repo-a", ...workflowSessionRecord };
  expect(taskObserver.resolveSessionAssociation(ref)?.taskId).toBe("task-1");
  expect(
    taskObserver.resolveSessionAssociation({ ...ref, workingDirectory: "/different" }),
  ).toBeNull();
  let listener = (_envelope: AgentSessionLiveEnvelope) => {};
  const published: NotificationOccurrence[] = [];
  const observer = createNotificationWorkspaceObserver({
    observe: async (_input, next) => {
      listener = next;
      return () => {};
    },
    taskObserver,
    publish: (item) => published.push(item),
    onFailure,
  });
  await observer.syncWorkspaces(workspaces);
  const live: AgentSessionLiveSnapshot = {
    ref,
    activity: "running",
    startedAt: "2026-09-05T10:00:00.000Z",
    title: "Builder",
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
    executionEpisodeId: "episode-1",
  };
  listener({ type: "session_upsert", session: live });
  listener({ type: "session_upsert", session: { ...live, activity: "idle" } });
  expect(published).toEqual([]);
  listener({
    type: "transcript_event",
    event: {
      type: "session_idle",
      sessionRef: ref,
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-09-05T10:01:00.000Z",
    },
  });
  expect(published).toMatchObject([{ kind: "agent.session_idle", task: { id: "task-1" } }]);
  observer.dispose();
});

test("creation snapshots preserve queued transitions and do not rewind existing tasks", async () => {
  const existing = createTaskCardFixture({
    id: "existing",
    title: "Existing",
    status: "in_progress",
  });
  const created = createTaskCardFixture({ id: "created", title: "Created", status: "open" });
  let currentTasks = [existing];
  const loadTasks = mock(async () => currentTasks);
  const loadSessionRecords = mock(async () => ({}));
  const published: NotificationOccurrence[] = [];
  const taskObserver = createNotificationTaskObserver({
    loadTasks,
    loadSessionRecords,
    publish: (occurrence) => published.push(occurrence),
    onFailure: () => {},
  });
  await taskObserver.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
  currentTasks = [
    { ...existing, status: "closed" },
    { ...created, status: "in_progress" },
  ];
  const creation = {
    kind: "external_task_created" as const,
    eventId: "create",
    repoPath: "/repo-a",
    taskId: created.id,
    taskSnapshot: { id: created.id, title: created.title, status: created.status },
    emittedAt: "2026-09-06T00:00:00.000Z",
  };
  await taskObserver.sink.onChange(creation);
  expect(loadTasks).toHaveBeenCalledTimes(1);
  expect(loadSessionRecords).toHaveBeenLastCalledWith("/repo-a", [created.id]);
  expect(taskObserver.resolveTask("/repo-a", existing.id)).toEqual({
    id: existing.id,
    title: existing.title,
  });
  expect(published).toEqual([]);
  const update = {
    kind: "tasks_updated" as const,
    eventId: "update",
    repoPath: "/repo-a",
    taskIds: [existing.id, created.id],
    removedTaskIds: [],
    statusChanges: [
      {
        previousStatus: existing.status,
        task: { id: existing.id, title: existing.title, status: "closed" as const },
      },
      {
        previousStatus: created.status,
        task: { id: created.id, title: created.title, status: "in_progress" as const },
      },
    ],
    taskSnapshots: currentTasks.map(({ id, title, status }) => ({ id, title, status })),
    emittedAt: "2026-09-06T00:00:01.000Z",
  };
  await taskObserver.sink.onChange(update);
  expect(published.map((occurrence) => occurrence.kind)).toEqual([
    "workflow.closed",
    "workflow.in_progress",
  ]);
  await taskObserver.sink.onChange(creation);
  await taskObserver.sink.onChange({ ...update, eventId: "same-status", statusChanges: [] });
  expect(published).toHaveLength(2);
  expect(loadTasks).toHaveBeenCalledTimes(1);
});

test.each(["fault", "transcript_gap"] as const)(
  "reports %s and keeps the live subscription active without replaying reconnect inputs",
  async (type) => {
    let receive = (_envelope: AgentSessionLiveEnvelope): void => {};
    const onFailure = mock(() => {});
    const published: NotificationOccurrence[] = [];
    const stop = mock(() => {});
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => [createTaskCardFixture({ id: "task-1" })],
      loadSessionRecords: loadWorkflowSessionRecords,
      publish: (occurrence) => published.push(occurrence),
      onFailure,
    });
    const observer = createNotificationWorkspaceObserver({
      observe: async (_input, listener) => {
        receive = listener;
        return stop;
      },
      taskObserver,
      publish: (occurrence) => published.push(occurrence),
      onFailure,
    });
    await observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    await flush();
    receive(liveSnapshot([]));
    const failure = { type, repoPath: "/repo-a", message: "Live data is incomplete." };
    receive(failure);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      source: "session",
      cause: new Error(failure.message),
    });
    expect(published).toEqual([]);
    expect(stop).not.toHaveBeenCalled();
    receive({ ...liveSnapshot(["missed"]), isConnectionSnapshot: true });
    expect(published).toEqual([]);
    receive(liveUpsert(["missed", "new"]));
    expect(published).toHaveLength(1);
    expect(published[0]?.navigationTarget).toMatchObject({ requestId: "new" });
    observer.dispose();
    receive(failure);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  },
);

test("preserves buffered transitions when snapshot refresh has already read their final state", async () => {
  const initial = createTaskCardFixture({ id: "task-1", title: "Task", status: "open" });
  const final = { ...initial, status: "ready_for_dev" as const };
  let completeRefresh = (_tasks: TaskCard[]) => {};
  let loadCount = 0;
  const published: NotificationOccurrence[] = [];
  const observer = createNotificationTaskObserver({
    loadTasks: async () => {
      if (++loadCount === 1) return [initial];
      return new Promise<TaskCard[]>((resolve) => {
        completeRefresh = resolve;
      });
    },
    loadSessionRecords: async () => ({}),
    publish: (occurrence) => published.push(occurrence),
    onFailure: (failure) => {
      throw failure.cause;
    },
  });
  await observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
  const refresh = observer.sink.onSnapshot();
  completeRefresh([final]);
  await refresh;
  expect(published).toEqual([]);
  const events = [
    { eventId: "to-spec", previousStatus: "open", status: "spec_ready" },
    { eventId: "to-dev", previousStatus: "spec_ready", status: "ready_for_dev" },
  ] as const;
  for (const { eventId, previousStatus, status } of events) {
    const event = {
      kind: "tasks_updated" as const,
      repoPath: "/repo-a",
      eventId,
      taskIds: [initial.id],
      removedTaskIds: [],
      taskSnapshots: [final],
      statusChanges: [
        { previousStatus, task: { id: initial.id, title: "Committed task", status } },
      ],
      emittedAt: "2026-09-06T10:00:00.000Z",
    };
    await observer.sink.onChange(event);
    await observer.sink.onChange(event);
  }
  expect(published.map(({ kind, task }) => ({ kind, task }))).toEqual([
    { kind: "workflow.spec_ready", task: { id: initial.id, title: "Committed task" } },
    { kind: "workflow.ready_for_dev", task: { id: initial.id, title: "Committed task" } },
  ]);
  const secondRefresh = observer.sink.onSnapshot();
  completeRefresh([final]);
  await secondRefresh;
  await observer.sink.onChange({
    kind: "tasks_updated",
    repoPath: "/repo-a",
    eventId: "to-dev",
    taskIds: [initial.id],
    removedTaskIds: [],
    taskSnapshots: [final],
    statusChanges: [{ previousStatus: "spec_ready", task: final }],
    emittedAt: "2026-09-06T10:00:00.000Z",
  });
  expect(published).toHaveLength(2);
});
