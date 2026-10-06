import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HostOperationError } from "../../../effect/host-errors";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import { createTaskSyncServiceForTest, createEventBus } from "./task-sync-service.test-support";

describe("task mutation gate and pull request sync", () => {
  test.each(["failure", "interruption"] as const)(
    "releases the repository mutation gate after %s",
    async (outcome) => {
      const sync = createTaskSyncServiceForTest({
        eventBus: createEventBus().eventBus,
        taskService: {
          repoPullRequestSyncDetailed: () => Effect.succeed({ ran: false, changedTaskIds: [] }),
        },
        workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
      });
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const first = yield* Effect.forkScoped(
              sync.runMutation(
                "/repo",
                Effect.gen(function* () {
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                  return yield* Effect.fail("Mutation failed");
                }),
              ),
            );
            yield* Deferred.await(entered);
            const queued = yield* Effect.forkScoped(
              sync.runMutation("/repo", Effect.succeed("next")),
            );
            expect(yield* sync.runMutation("/other-repo", Effect.succeed("independent"))).toBe(
              "independent",
            );
            if (outcome === "interruption") {
              yield* Fiber.interrupt(first);
            } else {
              yield* Deferred.succeed(release, undefined);
              expect(yield* Fiber.join(first).pipe(Effect.flip)).toBe("Mutation failed");
            }
            expect(yield* Fiber.join(queued)).toBe("next");
          }),
        ),
      );
    },
  );

  test("does not construct an event for a legitimate no-op pull request sync", async () => {
    const { eventBus, events } = createEventBus();
    const reports: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus,
      publicationReporter: {
        report: (failure) =>
          Effect.sync(() => {
            reports.push(failure);
          }),
      },
      taskService: {
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
      workspaceSettingsService: {
        listWorkspaces: () => Effect.succeed([]),
      },
    });

    await expect(Effect.runPromise(service.syncRepoPullRequests("/repo"))).resolves.toEqual({
      ran: true,
      changedTaskIds: [],
    });

    expect(events).toEqual([]);
    expect(reports).toEqual([]);
  });

  test("runs linked pull request sync for the active workspace and emits changed task ids", async () => {
    const { eventBus, events } = createEventBus();
    const calls: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 60000,
      taskService: {
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
      },
      workspaceSettingsService: {
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return [
                {
                  workspaceId: "repo",
                  workspaceName: "Repo",
                  abbreviation: null,
                  tileColor: null,
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
      },
    });
    await Effect.runPromise(service.syncActiveWorkspacePullRequests());
    expect(calls).toEqual([{ repoPath: "/repo" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
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
      taskService: {
        repoPullRequestSyncDetailed() {
          return Effect.fail(
            new TaskMutationProgressFailure({
              operation: "repo-pull-request-sync",
              changes: { taskIds: ["task-1", "task-2"], removedTaskIds: [] },
              failure: mutationFailure,
            }),
          );
        },
      },
      workspaceSettingsService: {
        listWorkspaces() {
          return Effect.succeed([
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              abbreviation: null,
              tileColor: null,
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ]);
        },
      },
    });

    await expect(
      Effect.runPromise(service.syncActiveWorkspacePullRequests().pipe(Effect.flip)),
    ).resolves.toBe(mutationFailure);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
    });
  });

  test("retains partial pull request sync failure when its snapshot read fails", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "Second task failed",
    });
    const snapshotFailure = new HostOperationError({
      operation: "task.list",
      message: "Snapshot unavailable",
    });
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: {
        listTasks: () => Effect.fail(snapshotFailure),
        repoPullRequestSyncDetailed: () =>
          Effect.fail(
            new TaskMutationProgressFailure({
              operation: "repo-pull-request-sync",
              changes: { taskIds: ["task-1"], removedTaskIds: [] },
              failure: mutationFailure,
            }),
          ),
      },
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
    });
    const failure = await Effect.runPromise(
      service.syncRepoPullRequests("/repo").pipe(Effect.flip),
    );
    expect(failure.message).toContain(mutationFailure.message);
    expect(failure.message).toContain("Task changes were saved");
    expect(failure).toMatchObject({ cause: { mutationFailure, snapshotFailure } });
    expect(events).toEqual([]);
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
      },
      taskService: {
        repoPullRequestSyncDetailed: () =>
          Effect.fail(
            new TaskMutationProgressFailure({
              operation: "repo-pull-request-sync",
              changes: { taskIds: ["task-1"], removedTaskIds: [] },
              failure: mutationFailure,
            }),
          ),
      },
      workspaceSettingsService: {
        listWorkspaces: () =>
          Effect.succeed([
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              abbreviation: null,
              tileColor: null,
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ]),
      },
    });

    await expect(
      Effect.runPromise(service.syncActiveWorkspacePullRequests().pipe(Effect.flip)),
    ).resolves.toBe(mutationFailure);
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
              }).pipe(Effect.andThen(Deferred.succeed(logged, undefined))),
          },
          taskService: {
            repoPullRequestSyncDetailed: () =>
              Effect.fail(
                new TaskMutationProgressFailure({
                  operation: "repo-pull-request-sync",
                  changes: { taskIds: ["task-1"], removedTaskIds: [] },
                  failure: mutationFailure,
                }),
              ),
          },
          workspaceSettingsService: {
            listWorkspaces: () =>
              Effect.succeed([
                {
                  workspaceId: "repo",
                  workspaceName: "Repo",
                  abbreviation: null,
                  tileColor: null,
                  repoPath: "/repo",
                  isActive: true,
                  hasConfig: true,
                  configuredWorktreeBasePath: null,
                  defaultWorktreeBasePath: null,
                  effectiveWorktreeBasePath: null,
                },
              ]),
          },
        });
        const loop = yield* service.startPullRequestSyncLoop();
        yield* TestClock.adjust(1);
        yield* Deferred.await(logged);
        yield* loop.stop();
        return { logCalls };
      }).pipe(Effect.provide(TestClock.layer())),
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
      taskService: {
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
      },
      workspaceSettingsService: {
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
      },
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
          taskService: {
            repoPullRequestSyncDetailed() {
              return Effect.succeed({ ran: true, changedTaskIds: [] });
            },
          },
          workspaceSettingsService: {
            listWorkspaces() {
              return Effect.fail(
                new HostOperationError({
                  operation: "test.task-sync.list-workspaces",
                  message: "workspace read failed",
                }),
              );
            },
          },
        });

        const loop = yield* service.startPullRequestSyncLoop();
        const reportedFailure = yield* Deferred.await(failureReported);
        const stopResult = yield* Effect.result(loop.stop());
        return { reportedFailure, stopResult };
      }),
    );

    expect(reportedFailure).toMatchObject({
      _tag: "HostOperationError",
      operation: "task-sync.log-iteration-failure",
      cause: persistenceError,
    });
    expect(stopResult._tag).toBe("Failure");
    if (stopResult._tag === "Success") {
      throw new Error("expected task-sync loop logging failure");
    }
    expect(stopResult.failure).toMatchObject({
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
          taskService: {
            repoPullRequestSyncDetailed() {
              return Effect.succeed({ ran: true, changedTaskIds: [] });
            },
          },
          workspaceSettingsService: {
            listWorkspaces() {
              return Effect.fail(
                new HostOperationError({
                  operation: "test.task-sync.list-workspaces",
                  message: "workspace read failed",
                }),
              );
            },
          },
        });

        const loop = yield* service.startPullRequestSyncLoop();
        yield* Deferred.await(logStarted);
        const stopFiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.succeed(stopStarted, undefined);
            return yield* Effect.result(loop.stop());
          }),
        );
        yield* Deferred.await(stopStarted);
        yield* Effect.yieldNow;
        const stopBeforeRelease = stopFiber.pollUnsafe();
        yield* Deferred.succeed(releaseLog, undefined);
        const stopResult = yield* Fiber.join(stopFiber);
        return { stopBeforeRelease, stopResult };
      }),
    );

    expect(stopBeforeRelease).toBeUndefined();
    expect(stopResult._tag).toBe("Success");
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
          taskService: {
            repoPullRequestSyncDetailed() {
              return Effect.succeed({ ran: true, changedTaskIds: [] });
            },
          },
          workspaceSettingsService: {
            listWorkspaces() {
              return Effect.fail(
                new HostOperationError({
                  operation: "test.task-sync.list-workspaces",
                  message: "workspace read failed",
                }),
              );
            },
          },
        });

        const loop = yield* service.startPullRequestSyncLoop();
        yield* Deferred.await(logStarted);
        const stopFiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.succeed(stopStarted, undefined);
            return yield* Effect.result(loop.stop());
          }),
        );
        yield* Deferred.await(stopStarted);
        yield* Effect.yieldNow;
        const stopBeforeRelease = stopFiber.pollUnsafe();
        yield* Deferred.succeed(releaseLog, undefined);
        const stopResult = yield* Fiber.join(stopFiber);
        return { stopBeforeRelease, stopResult };
      }),
    );

    expect(stopBeforeRelease).toBeUndefined();
    expect(stopResult._tag).toBe("Failure");
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
          taskService: {
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
          },
          workspaceSettingsService: {
            listWorkspaces() {
              return Effect.succeed([
                {
                  workspaceId: "repo",
                  workspaceName: "Repo",
                  abbreviation: null,
                  tileColor: null,
                  repoPath: "/repo",
                  isActive: true,
                  hasConfig: true,
                  configuredWorktreeBasePath: null,
                  defaultWorktreeBasePath: null,
                  effectiveWorktreeBasePath: null,
                },
              ]);
            },
          },
        });

        const loop = yield* service.startPullRequestSyncLoop();
        yield* TestClock.adjust(1);
        yield* Deferred.await(syncStarted);
        yield* loop.stop();
        const beforeRelease = [...events];
        yield* Deferred.succeed(releaseSync, undefined);
        yield* Deferred.await(syncFinished);
        yield* Effect.yieldNow;
        return { beforeRelease, afterRelease: [...events] };
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(eventsBeforeAndAfterRelease).toEqual({ beforeRelease: [], afterRelease: [] });
  });
});
