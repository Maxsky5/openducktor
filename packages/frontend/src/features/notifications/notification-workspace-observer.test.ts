import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  AgentSessionLiveSnapshot,
  AgentSessionLiveEnvelope,
  NotificationOccurrence,
  TaskCard,
} from "@openducktor/contracts";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createNotificationTaskObserver as createTaskObserver } from "./notification-task-observer";
import { createNotificationWorkspaceObserver } from "./notification-workspace-observer";

type AgentSessionLiveSnapshotEnvelope = Extract<AgentSessionLiveEnvelope, { type: "snapshot" }>;

import { QueryClient } from "@tanstack/react-query";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { readCachedAgentSessionAssociation } from "@/state/queries/agent-session-association";

const createNotificationTaskObserver = (
  options: Omit<Parameters<typeof createTaskObserver>[0], "resolveSessionAssociation">,
) => {
  const queryClient = new QueryClient();
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
    expect(observe).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    fail = false;
    await observer.syncWorkspaces(workspaces);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(taskObserver.resolveTask("/repo-a", "task-1")?.id).toBe("task-1");
    observer.dispose();
  },
);

test("reads new ownership from Query before the queued task notification sink runs", async () => {
  const queryClient = new QueryClient();
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
  await observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo" }]);
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo-a", "task-1"), [
    workflowSessionRecord,
  ]);
  listener(liveSnapshot(["existing"]));
  expect(published).toEqual([]);
  listener(liveUpsert(["existing", "new"]));
  expect(published.map((item) => item.kind)).toEqual(["agent.permission_requested"]);
  observer.dispose();
});

describe("all-workspace notification observation", () => {
  test("does not restore a workspace removed while its baseline is loading", async () => {
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

    const add = observer.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    await flush();
    await observer.syncWorkspaces([]);
    finishBaseline?.([createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })]);
    await add;

    expect(observe).not.toHaveBeenCalled();
    expect(taskObserver.resolveTask("/repo-a", "task-1")).toBeNull();
  });

  test("does not observe a workspace before its pending baseline finishes", async () => {
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

    expect(observe).not.toHaveBeenCalled();
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
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "spec_ready" }],
      emittedAt: "2026-08-31T10:01:00.000Z",
    });

    expect(published).toMatchObject([
      {
        kind: "workflow.spec_ready",
        occurrenceId: "workflow.spec_ready:/repo-a:task-1:event-1",
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
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "spec_ready" }],
      emittedAt: "2026-08-31T10:01:00.000Z",
    });
    await taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-ready-for-dev",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      taskSnapshots: [{ id: "task-1", title: "Task A", status: "ready_for_dev" }],
      emittedAt: "2026-08-31T10:02:00.000Z",
    });

    expect(published.map(({ kind, occurrenceId }) => ({ kind, occurrenceId }))).toEqual([
      {
        kind: "workflow.spec_ready",
        occurrenceId: "workflow.spec_ready:/repo-a:task-1:event-spec-ready",
      },
      {
        kind: "workflow.ready_for_dev",
        occurrenceId: "workflow.ready_for_dev:/repo-a:task-1:event-ready-for-dev",
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
  expect(published).toMatchObject([{ kind: "agent.session_idle", task: { id: "task-1" } }]);
  observer.dispose();
});
