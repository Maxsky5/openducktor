import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { HostEventBusPort } from "../../../events/host-event-bus";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskService } from "../task-service";
import { createTaskSyncService } from "./task-sync-service";

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const createTaskSyncServiceForTest = (input: Parameters<typeof createTaskSyncService>[0]) =>
  createTaskSyncService(input);
const createEventBus = () => {
  const events: Array<{
    channel: string;
    payload: unknown;
  }> = [];
  const eventBus: HostEventBusPort = {
    publish(channel, payload) {
      events.push({ channel, payload });
    },
    subscribe() {
      return () => {};
    },
  };
  return { eventBus, events };
};
const createTaskServiceFake = (
  service: Pick<TaskService, "repoPullRequestSyncDetailed">,
): TaskService => service as unknown as TaskService;
const createWorkspaceSettingsServiceFake = (
  service: Pick<WorkspaceSettingsService, "listWorkspaces">,
): WorkspaceSettingsService => service as unknown as WorkspaceSettingsService;
describe("createTaskSyncService", () => {
  test("publishes host-compatible external task creation events", async () => {
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("unexpected pull request sync");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return [];
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    await Effect.runPromise(service.publishExternalTaskCreated("/repo", "task-1"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "openducktor://task-event",
      payload: {
        kind: "external_task_created",
        repoPath: "/repo",
        taskId: "task-1",
      },
    });
    expect(events[0]?.payload).toMatchObject({
      eventId: expect.any(String),
      emittedAt: expect.any(String),
    });
  });
  test("runs linked pull request sync for the active workspace and emits changed task ids", async () => {
    const { eventBus, events } = createEventBus();
    const calls: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 60000,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed(input) {
          return Effect.tryPromise({
            try: async () => {
              calls.push(input);
              return { ran: true, changedTaskIds: ["task-1", "task-2"] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return [
                {
                  workspaceId: "repo",
                  workspaceName: "Repo",
                  repoPath: "/repo",
                  isActive: true,
                  hasConfig: true,
                  configuredWorktreeBasePath: null,
                  defaultWorktreeBasePath: null,
                  effectiveWorktreeBasePath: null,
                },
              ];
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    await Effect.runPromise(service.syncActiveWorkspacePullRequests());
    expect(calls).toEqual([{ repoPath: "/repo" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "openducktor://task-event",
      payload: {
        kind: "tasks_updated",
        repoPath: "/repo",
        taskIds: ["task-1", "task-2"],
      },
    });
  });
  test("does not run pull request sync during loop startup", async () => {
    const { eventBus } = createEventBus();
    const calls: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 60000,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed(input) {
          return Effect.tryPromise({
            try: async () => {
              calls.push(input);
              return { ran: true, changedTaskIds: [] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("unexpected workspace lookup before first interval");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    const loop = await Effect.runPromise(service.startPullRequestSyncLoop());
    await Effect.runPromise(loop.stop());
    expect(calls).toEqual([]);
  });
  test("executes lifecycle logging Effects and returns logging failures from the loop owner", async () => {
    const { eventBus } = createEventBus();
    const persistenceError = new HostOperationError({
      operation: "host.lifecycle.log-error",
      message: "persistent task-sync log failed",
    });
    let loggerEffects = 0;
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 1,
      logger: {
        error: () =>
          Effect.sync(() => {
            loggerEffects += 1;
          }).pipe(Effect.zipRight(Effect.fail(persistenceError))),
      },
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed() {
          return Effect.succeed({ ran: true, changedTaskIds: [] });
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.fail(
            new HostOperationError({
              operation: "test.task-sync.list-workspaces",
              message: "workspace read failed",
            }),
          );
        },
      }),
    });

    const loop = await Effect.runPromise(service.startPullRequestSyncLoop());
    await sleep(20);

    expect(loggerEffects).toBe(1);
    const stopResult = await Effect.runPromise(Effect.either(loop.stop()));
    expect(stopResult._tag).toBe("Left");
    if (stopResult._tag === "Right") {
      throw new Error("expected task-sync loop logging failure");
    }
    expect(stopResult.left).toMatchObject({
      _tag: "HostOperationError",
      operation: "task-sync.log-iteration-failure",
      cause: persistenceError,
    });
  });
  test("stops without waiting for an in-flight pull request sync iteration", async () => {
    const { eventBus, events } = createEventBus();
    let resolveSyncStarted: () => void = () => {};
    const syncStarted = new Promise<void>((resolve) => {
      resolveSyncStarted = resolve;
    });
    let releaseSync: () => void = () => {};
    const syncReleased = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let resolveSyncFinished: () => void = () => {};
    const syncFinished = new Promise<void>((resolve) => {
      resolveSyncFinished = resolve;
    });
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 1,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed() {
          return Effect.uninterruptible(
            Effect.gen(function* () {
              resolveSyncStarted();
              yield* Effect.promise(() => syncReleased);
              resolveSyncFinished();
              return { ran: true, changedTaskIds: ["task-1"] };
            }),
          );
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.succeed([
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ]);
        },
      }),
    });

    const loop = await Effect.runPromise(service.startPullRequestSyncLoop());
    await syncStarted;

    try {
      const stopPromise = Effect.runPromise(loop.stop()).then(() => "stopped" as const);
      const stopBeforeRelease = await Promise.race([
        stopPromise,
        sleep(50).then(() => "waiting" as const),
      ]);

      expect(stopBeforeRelease).toBe("stopped");
      expect(events).toEqual([]);
      releaseSync();
      await syncFinished;
      await Effect.runPromise(Effect.yieldNow());
      expect(events).toEqual([]);
    } finally {
      releaseSync();
    }
  });
});
