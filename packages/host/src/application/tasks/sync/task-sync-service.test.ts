import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { HostEventBusPort } from "../../../events/host-event-bus";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import { RepoPullRequestSyncPartialFailure } from "../repo-pull-request-sync-partial-failure";
import type { TaskService } from "../task-service";
import { createTaskSyncService } from "./task-sync-service";

type TaskSyncServiceTestInput = Omit<
  Parameters<typeof createTaskSyncService>[0],
  "onBackgroundFailure"
> &
  Partial<Pick<Parameters<typeof createTaskSyncService>[0], "onBackgroundFailure">>;

const createTaskSyncServiceForTest = (input: TaskSyncServiceTestInput) =>
  createTaskSyncService({
    ...input,
    onBackgroundFailure: input.onBackgroundFailure ?? (() => Effect.void),
  });
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
  test("publishes partial sync progress once and returns the original failure", async () => {
    const { eventBus, events } = createEventBus();
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "second task failed",
    });
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed() {
          return Effect.fail(
            new RepoPullRequestSyncPartialFailure({
              changedTaskIds: ["task-1", "task-1", "task-2"],
              failure: mutationFailure,
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

    await expect(
      Effect.runPromise(service.syncActiveWorkspacePullRequests().pipe(Effect.flip)),
    ).resolves.toBe(mutationFailure);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: { kind: "tasks_updated", repoPath: "/repo", taskIds: ["task-1", "task-2"] },
    });
  });
  test("combines partial sync and publication failures", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "second task failed",
    });
    const publicationCause = new Error("event bus failed");
    const service = createTaskSyncServiceForTest({
      eventBus: {
        publish() {
          throw publicationCause;
        },
        subscribe() {
          return () => {};
        },
      },
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed: () =>
          Effect.fail(
            new RepoPullRequestSyncPartialFailure({
              changedTaskIds: ["task-1"],
              failure: mutationFailure,
            }),
          ),
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces: () =>
          Effect.succeed([
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
          ]),
      }),
    });

    await expect(
      Effect.runPromise(service.syncActiveWorkspacePullRequests().pipe(Effect.flip)),
    ).resolves.toMatchObject({
      operation: "task-sync.pull-request-sync",
      cause: mutationFailure,
      details: { mutationFailure },
    });
  });
  test("logs a partial sync failure once after publishing one batch in the scheduler loop", async () => {
    const { eventBus, events } = createEventBus();
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "second task failed",
    });
    const { logCalls } = await Effect.runPromise(
      Effect.gen(function* () {
        const logged = yield* Deferred.make<void>();
        let logCalls = 0;
        const service = createTaskSyncServiceForTest({
          eventBus,
          intervalMs: 1,
          logger: {
            error: () =>
              Effect.sync(() => {
                logCalls += 1;
              }).pipe(Effect.zipRight(Deferred.succeed(logged, undefined))),
          },
          taskService: createTaskServiceFake({
            repoPullRequestSyncDetailed: () =>
              Effect.fail(
                new RepoPullRequestSyncPartialFailure({
                  changedTaskIds: ["task-1"],
                  failure: mutationFailure,
                }),
              ),
          }),
          workspaceSettingsService: createWorkspaceSettingsServiceFake({
            listWorkspaces: () =>
              Effect.succeed([
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
              ]),
          }),
        });
        const loop = yield* service.startPullRequestSyncLoop();
        yield* TestClock.adjust(1);
        yield* Deferred.await(logged);
        yield* loop.stop();
        return { logCalls };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(logCalls).toBe(1);
    expect(events).toHaveLength(1);
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
  test("reports lifecycle logging failures to the live owner before shutdown", async () => {
    const { eventBus } = createEventBus();
    const persistenceError = new HostOperationError({
      operation: "host.lifecycle.log-error",
      message: "persistent task-sync log failed",
    });
    const { reportedFailure, stopResult } = await Effect.runPromise(
      Effect.gen(function* () {
        const failureReported = yield* Deferred.make<HostOperationError>();
        const service = createTaskSyncServiceForTest({
          eventBus,
          intervalMs: 0,
          logger: {
            error: () => Effect.fail(persistenceError),
          },
          onBackgroundFailure: (failure) =>
            Deferred.succeed(failureReported, failure).pipe(Effect.asVoid),
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

        const loop = yield* service.startPullRequestSyncLoop();
        const reportedFailure = yield* Deferred.await(failureReported);
        const stopResult = yield* Effect.either(loop.stop());
        return { reportedFailure, stopResult };
      }),
    );

    expect(reportedFailure).toMatchObject({
      _tag: "HostOperationError",
      operation: "task-sync.log-iteration-failure",
      cause: persistenceError,
    });
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
  test("waits for an admitted lifecycle log append before shutdown completes", async () => {
    const { eventBus } = createEventBus();
    const { stopBeforeRelease, stopResult } = await Effect.runPromise(
      Effect.gen(function* () {
        const logStarted = yield* Deferred.make<void>();
        const releaseLog = yield* Deferred.make<void>();
        const stopStarted = yield* Deferred.make<void>();
        const service = createTaskSyncServiceForTest({
          eventBus,
          intervalMs: 0,
          logger: {
            error: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(logStarted, undefined);
                yield* Deferred.await(releaseLog);
              }),
          },
          onBackgroundFailure: () => Effect.void,
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

        const loop = yield* service.startPullRequestSyncLoop();
        yield* Deferred.await(logStarted);
        const stopFiber = yield* Effect.fork(
          Effect.gen(function* () {
            yield* Deferred.succeed(stopStarted, undefined);
            return yield* Effect.either(loop.stop());
          }),
        );
        yield* Deferred.await(stopStarted);
        yield* Effect.yieldNow();
        const stopBeforeRelease = yield* Fiber.poll(stopFiber);
        yield* Deferred.succeed(releaseLog, undefined);
        const stopResult = yield* Fiber.join(stopFiber);
        return { stopBeforeRelease, stopResult };
      }),
    );

    expect(stopBeforeRelease._tag).toBe("None");
    expect(stopResult._tag).toBe("Right");
  });
  test("does not lose an admitted lifecycle logging failure racing shutdown", async () => {
    const { eventBus } = createEventBus();
    const persistenceError = new HostOperationError({
      operation: "host.lifecycle.log-error",
      message: "persistent task-sync log failed during shutdown",
    });
    const reportedFailures: HostOperationError[] = [];
    const { stopBeforeRelease, stopResult } = await Effect.runPromise(
      Effect.gen(function* () {
        const logStarted = yield* Deferred.make<void>();
        const releaseLog = yield* Deferred.make<void>();
        const stopStarted = yield* Deferred.make<void>();
        const service = createTaskSyncServiceForTest({
          eventBus,
          intervalMs: 0,
          logger: {
            error: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(logStarted, undefined);
                yield* Deferred.await(releaseLog);
                return yield* Effect.fail(persistenceError);
              }),
          },
          onBackgroundFailure: (failure) =>
            Effect.sync(() => {
              reportedFailures.push(failure);
            }),
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

        const loop = yield* service.startPullRequestSyncLoop();
        yield* Deferred.await(logStarted);
        const stopFiber = yield* Effect.fork(
          Effect.gen(function* () {
            yield* Deferred.succeed(stopStarted, undefined);
            return yield* Effect.either(loop.stop());
          }),
        );
        yield* Deferred.await(stopStarted);
        yield* Effect.yieldNow();
        const stopBeforeRelease = yield* Fiber.poll(stopFiber);
        yield* Deferred.succeed(releaseLog, undefined);
        const stopResult = yield* Fiber.join(stopFiber);
        return { stopBeforeRelease, stopResult };
      }),
    );

    expect(stopBeforeRelease._tag).toBe("None");
    expect(stopResult._tag).toBe("Left");
    expect(reportedFailures).toEqual([
      expect.objectContaining({
        _tag: "HostOperationError",
        operation: "task-sync.log-iteration-failure",
        cause: persistenceError,
      }),
    ]);
  });
  test("stops without waiting for an in-flight pull request sync iteration", async () => {
    const { eventBus, events } = createEventBus();
    const eventsBeforeAndAfterRelease = await Effect.runPromise(
      Effect.gen(function* () {
        const syncStarted = yield* Deferred.make<void>();
        const releaseSync = yield* Deferred.make<void>();
        const syncFinished = yield* Deferred.make<void>();
        const service = createTaskSyncServiceForTest({
          eventBus,
          intervalMs: 1,
          taskService: createTaskServiceFake({
            repoPullRequestSyncDetailed() {
              return Effect.uninterruptible(
                Effect.gen(function* () {
                  yield* Deferred.succeed(syncStarted, undefined);
                  yield* Deferred.await(releaseSync);
                  yield* Deferred.succeed(syncFinished, undefined);
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

        const loop = yield* service.startPullRequestSyncLoop();
        yield* TestClock.adjust(1);
        yield* Deferred.await(syncStarted);
        yield* loop.stop();
        const beforeRelease = [...events];
        yield* Deferred.succeed(releaseSync, undefined);
        yield* Deferred.await(syncFinished);
        yield* Effect.yieldNow();
        return { beforeRelease, afterRelease: [...events] };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(eventsBeforeAndAfterRelease).toEqual({ beforeRelease: [], afterRelease: [] });
  });
});
