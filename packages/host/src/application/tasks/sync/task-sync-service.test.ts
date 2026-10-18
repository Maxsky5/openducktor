import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HostOperationError } from "../../../effect/host-errors";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import { createTaskSyncServiceForTest, createEventBus } from "./task-sync-service.test-support";

const workspace = (repoPath: string, isActive = false): WorkspaceRecord => ({
  workspaceId: repoPath.slice(1),
  workspaceName: repoPath.slice(1),
  abbreviation: null,
  tileColor: null,
  repoPath,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
});

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

  test.each([true, false])(
    "syncs all open workspaces with an active workspace set to %s",
    async (hasActiveWorkspace) => {
      const { eventBus, events } = createEventBus();
      const calls: unknown[] = [];
      const service = createTaskSyncServiceForTest({
        eventBus,
        taskService: {
          repoPullRequestSyncDetailed(input) {
            return Effect.sync(() => {
              calls.push(input);
              return { ran: true, changedTaskIds: ["task-1", "task-2"] };
            });
          },
        },
        workspaceSettingsService: {
          listWorkspaces() {
            return Effect.succeed([
              workspace("/first"),
              workspace("/repo", hasActiveWorkspace),
              workspace("/last"),
            ]);
          },
        },
      });
      await Effect.runPromise(service.syncOpenWorkspacePullRequests());
      expect(calls).toEqual([{ repoPath: "/first" }, { repoPath: "/repo" }, { repoPath: "/last" }]);
      expect(events).toMatchObject(
        ["/first", "/repo", "/last"].map((repoPath) => ({
          kind: "tasks_updated",
          repoPath,
          taskIds: ["task-1", "task-2"],
        })),
      );
    },
  );

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
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
    });

    await expect(
      Effect.runPromise(service.syncRepoPullRequests("/repo").pipe(Effect.flip)),
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
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
    });

    await expect(
      Effect.runPromise(service.syncRepoPullRequests("/repo").pipe(Effect.flip)),
    ).resolves.toMatchObject({
      _tag: "HostOperationError",
      message: expect.stringContaining("second task failed"),
      cause: { mutationFailure, publicationFailure: publicationCause },
      details: { durableState: "committed", stage: "acceptance" },
    });
  });

  test("logs each failed workspace and continues after publishing partial sync progress", async () => {
    const { eventBus, events } = createEventBus();
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "second task failed",
    });
    const { logs, calls } = await Effect.runPromise(
      Effect.gen(function* () {
        const logs: string[] = [];
        const calls: string[] = [];
        const service = createTaskSyncServiceForTest({
          eventBus,
          logger: {
            error: (message) =>
              Effect.sync(() => {
                logs.push(message);
              }),
          },
          taskService: {
            repoPullRequestSyncDetailed: ({ repoPath }) =>
              Effect.gen(function* () {
                calls.push(repoPath);
                if (repoPath === "/partial") {
                  return yield* new TaskMutationProgressFailure({
                    operation: "repo-pull-request-sync",
                    changes: { taskIds: ["task-1"], removedTaskIds: [] },
                    failure: mutationFailure,
                  });
                }
                if (repoPath === "/failed") {
                  return yield* new HostOperationError({
                    operation: "task.repo-pull-request-sync",
                    message: "provider unavailable",
                  });
                }
                return { ran: true, changedTaskIds: ["task-2"] };
              }),
          },
          workspaceSettingsService: {
            listWorkspaces: () =>
              Effect.succeed([
                workspace("/partial"),
                workspace("/failed", true),
                workspace("/healthy"),
              ]),
          },
        });
        const loop = yield* service.startPullRequestSyncLoop();
        yield* TestClock.adjust(0);
        yield* loop.stop();
        return { logs, calls };
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(calls).toEqual(["/partial", "/failed", "/healthy"]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("/partial");
    expect(logs[0]).toContain("second task failed");
    expect(logs[1]).toContain("/failed");
    expect(logs[1]).toContain("provider unavailable");
    expect(
      logs.every((message) => message.includes("the scheduler will retry on the next interval")),
    ).toBe(true);
    expect(events).toMatchObject([
      { repoPath: "/partial", taskIds: ["task-1"] },
      { repoPath: "/healthy", taskIds: ["task-2"] },
    ]);
  });

  test("syncs at startup, refreshes open workspaces each interval, and stops scheduling", async () => {
    const { eventBus } = createEventBus();
    const calls: unknown[] = [];
    let openWorkspaces = [workspace("/repo", true), workspace("/other")];
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: {
        repoPullRequestSyncDetailed(input) {
          return Effect.sync(() => {
            calls.push(input);
            return { ran: true, changedTaskIds: [] };
          });
        },
      },
      workspaceSettingsService: {
        listWorkspaces() {
          return Effect.sync(() => openWorkspaces);
        },
      },
    });
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const loop = yield* service.startPullRequestSyncLoop();
        try {
          yield* TestClock.adjust(0);
          const startup = [...calls];
          openWorkspaces = [workspace("/other")];
          yield* TestClock.adjust(5 * 60 * 1000 - 1);
          const beforeInterval = [...calls];
          yield* TestClock.adjust(1);
          const nextInterval = [...calls];
          yield* loop.stop();
          yield* TestClock.adjust(5 * 60 * 1000);
          return { startup, beforeInterval, nextInterval, afterStop: [...calls] };
        } finally {
          yield* loop.stop();
        }
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(snapshots).toEqual({
      startup: [{ repoPath: "/repo" }, { repoPath: "/other" }],
      beforeInterval: [{ repoPath: "/repo" }, { repoPath: "/other" }],
      nextInterval: [{ repoPath: "/repo" }, { repoPath: "/other" }, { repoPath: "/other" }],
      afterStop: [{ repoPath: "/repo" }, { repoPath: "/other" }, { repoPath: "/other" }],
    });
  });

  test.each(["workspace lookup", "workspace sync"])(
    "reports lifecycle logging failures during %s to the live owner before shutdown",
    async (failureStage) => {
      const { eventBus } = createEventBus();
      const persistenceError = new HostOperationError({
        operation: "host.lifecycle.log-error",
        message: "persistent task-sync log failed",
      });
      const calls: string[] = [];
      const logs: string[] = [];
      const { reportedFailure, stopResult } = await Effect.runPromise(
        Effect.gen(function* () {
          const failureReported = yield* Deferred.make<HostOperationError>();
          const service = createTaskSyncServiceForTest({
            eventBus,
            intervalMs: 0,
            logger: {
              error: (message) =>
                Effect.gen(function* () {
                  logs.push(message);
                  return yield* persistenceError;
                }),
            },
            onBackgroundFailure: (failure) =>
              Deferred.succeed(failureReported, failure).pipe(Effect.asVoid),
            taskService: {
              repoPullRequestSyncDetailed({ repoPath }) {
                return Effect.gen(function* () {
                  calls.push(repoPath);
                  return yield* new HostOperationError({
                    operation: "test.task-sync.provider",
                    message: "provider unavailable",
                  });
                });
              },
            },
            workspaceSettingsService: {
              listWorkspaces() {
                if (failureStage === "workspace sync") {
                  return Effect.succeed([workspace("/repo"), workspace("/other")]);
                }
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
      expect(logs).toHaveLength(1);
      expect(calls).toEqual(failureStage === "workspace sync" ? ["/repo"] : []);
      expect(stopResult._tag).toBe("Failure");
      if (stopResult._tag === "Success") {
        throw new Error("expected task-sync loop logging failure");
      }
      expect(stopResult.failure).toMatchObject({
        _tag: "HostOperationError",
        operation: "task-sync.log-iteration-failure",
        cause: persistenceError,
      });
    },
  );

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
    const calls: string[] = [];
    const eventsBeforeAndAfterRelease = await Effect.runPromise(
      Effect.gen(function* () {
        const syncStarted = yield* Deferred.make<void>();
        const releaseSync = yield* Deferred.make<void>();
        const syncFinished = yield* Deferred.make<void>();
        const service = createTaskSyncServiceForTest({
          eventBus,
          intervalMs: 1,
          taskService: {
            repoPullRequestSyncDetailed({ repoPath }) {
              return Effect.uninterruptible(
                Effect.gen(function* () {
                  calls.push(repoPath);
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
              return Effect.succeed([workspace("/repo", true), workspace("/other")]);
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
    expect(calls).toEqual(["/repo"]);
  });
});
