import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { Deferred, Effect, Fiber } from "effect";
import type {
  AgentSessionRecord,
  TaskCard,
  TaskCompletionObservation,
} from "@openducktor/contracts";
import { TerminalServiceError } from "../terminals/terminal-service";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { GitPort } from "../../ports/git-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  task,
} from "./test-support/task-workflow-harness";

const input = { repoPath: "/repo", taskId: "task-1", removeWorktree: true };
const createHarness = ({
  countLiveSessions = () => Effect.succeed({ liveSessionCount: 0 }),
  sync = Effect.succeed({ ahead: 0, behind: 0 }),
  cleanup = Effect.void,
  status = "human_review",
  role = "build",
  gitOverrides = {},
  closure = Effect.void,
}: {
  countLiveSessions?: TaskActivityGuardPort["countLiveSessions"];
  sync?: ReturnType<GitPort["commitsAheadBehind"]>;
  cleanup?: Effect.Effect<void, TerminalServiceError>;
  status?: TaskCard["status"];
  role?: AgentSessionRecord["role"];
  gitOverrides?: Partial<GitPort>;
  closure?: Effect.Effect<void, TaskStoreError>;
} = {}) => {
  const calls: unknown[] = [];
  const observations: TaskCompletionObservation[] = [];
  const coordinator = createTaskSessionLifecycleCoordinator();
  let current = task({ status });
  const service = createTaskService({
    taskWorkflows: builtinTaskWorkflows,
    publishCompletion: (observation) =>
      Effect.sync(() => {
        observations.push(observation);
      }),
    taskSessionLifecycleCoordinator: coordinator,
    taskActivityGuard: {
      countLiveSessions,
      // Completion stops nothing: it checked that no session runs. It releases the idle ones.
      cleanupTaskSessions: () => Effect.succeed({ stoppedSessionCount: 0 }),
    },
    terminalService: {
      acquireTaskCleanup: () =>
        Effect.sync(() => calls.push("cleanup")).pipe(
          Effect.andThen(cleanup),
          Effect.as({ closedTerminalIds: [] }),
        ),
    },
    gitPort: extendGitPort(
      createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/repo": { name: "main", detached: false },
        },
      }),
      {
        commitsAheadBehind: () => sync,
        inspectPublication: (target) =>
          sync.pipe(
            Effect.map(({ ahead, behind }) =>
              target.endpoints.map((endpoint) => ({
                destinationIdentity: endpoint.identity,
                oid: ahead === 0 && behind === 0 ? target.sourceOid : null,
              })),
            ),
          ),
        ...gitOverrides,
      },
    ),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
    taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { postComplete: [] },
      defaultTargetBranch: { remote: "origin", branch: "main" },
    }),
    taskStore: {
      listTasks: () => Effect.sync(() => [current]),
      getTaskMetadata: () =>
        Effect.succeed({
          artifacts: {},
          agentSessions: [createAgentSessionRecord({ role })],
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-09-05T10:00:00Z",
          },
        }),
      transitionTask: ({ status: nextStatus }) =>
        closure.pipe(
          Effect.andThen(
            Effect.sync(() => {
              calls.push(nextStatus);
              current = { ...current, status: nextStatus };
              return current;
            }),
          ),
        ),
    },
  });
  return { service, calls, coordinator, observations };
};

const createSourceBranch = ({
  beforeDelete = Effect.void,
  afterDelete = Effect.void,
}: {
  beforeDelete?: Effect.Effect<void>;
  afterDelete?: Effect.Effect<void>;
} = {}) => {
  const branch = { name: "odt/task-1", oid: "b".repeat(40) };
  let exists = true;
  let restores = 0;
  const gitOverrides: Partial<GitPort> = {
    listBranches: () =>
      Effect.sync(() => (exists ? [{ name: branch.name, isCurrent: false, isRemote: false }] : [])),
    isMergeIncluded: () => Effect.sync(() => exists),
    deleteLocalBranch: (_repo, _name, _force, onDeleting) =>
      Effect.sync(() => onDeleting?.(branch)).pipe(
        Effect.andThen(beforeDelete),
        Effect.andThen(
          Effect.sync(() => {
            exists = false;
          }),
        ),
        Effect.andThen(afterDelete),
      ),
    restoreDeletedBranch: (_repo, receipt) =>
      Effect.sync(() => {
        expect(receipt).toEqual(branch);
        exists = true;
        restores += 1;
      }),
  };
  return { gitOverrides, exists: () => exists, restores: () => restores };
};

describe("direct merge completion session guard", () => {
  test.each(["before deletion", "after deletion"] as const)(
    "a rejected completion cannot change the owner's recovery or observations %s",
    async (boundary) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const pause = Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            );
            const source = createSourceBranch(
              boundary === "before deletion" ? { beforeDelete: pause } : { afterDelete: pause },
            );
            const harness = createHarness({
              gitOverrides: source.gitOverrides,
              closure:
                boundary === "before deletion"
                  ? Effect.fail(
                      new HostOperationError({
                        operation: "task.close",
                        message: "Closure failed",
                      }),
                    )
                  : Effect.void,
            });
            const worker = yield* Effect.forkScoped(
              Effect.result(harness.service.completeDirectMerge(input)),
            );
            yield* Deferred.await(entered);
            const observations = structuredClone(harness.observations);
            yield* Effect.gen(function* () {
              const rejected = yield* Effect.result(harness.service.completeDirectMerge(input));
              expect(rejected).toMatchObject({
                _tag: "Failure",
                failure: { message: expect.stringContaining("another lifecycle operation") },
              });
              expect(source.restores()).toBe(0);
              expect(harness.observations).toEqual(observations);
            }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
            const result = yield* Fiber.join(worker);
            if (boundary === "before deletion") {
              expect(result).toMatchObject({
                _tag: "Failure",
                failure: { message: expect.stringContaining("Closure failed") },
              });
              expect(source.exists()).toBe(true);
              expect(source.restores()).toBe(1);
              expect(harness.calls).not.toContain("closed");
            } else {
              expect(result).toMatchObject({ _tag: "Success", success: { status: "closed" } });
              expect(source.exists()).toBe(false);
              expect(source.restores()).toBe(0);
            }
          }),
        ),
      );
    },
  );

  test("restores source evidence after closure failure so restart finishes without another publication", async () => {
    const source = createSourceBranch();
    const first = createHarness({
      gitOverrides: source.gitOverrides,
      closure: Effect.fail(
        new HostOperationError({ operation: "task.close", message: "Closure failed" }),
      ),
    });
    await expect(Effect.runPromise(first.service.completeDirectMerge(input))).rejects.toThrow(
      "Closure failed",
    );
    expect(source.exists()).toBe(true);
    expect(source.restores()).toBe(1);
    const restarted = createHarness({ gitOverrides: source.gitOverrides });
    expect((await Effect.runPromise(restarted.service.completeDirectMerge(input))).status).toBe(
      "closed",
    );
    expect(source.exists()).toBe(false);
    expect(source.restores()).toBe(1);
  });

  test("deletes every related task branch and restores each one after a failed close", async () => {
    const branches = new Map([
      ["odt/task-1", "b".repeat(40)],
      ["odt/task-1-retry", "c".repeat(40)],
    ]);
    const restored: string[] = [];
    const harness = createHarness({
      gitOverrides: {
        listBranches: () =>
          Effect.sync(() =>
            [...branches.keys()].map((name) => ({ name, isCurrent: false, isRemote: false })),
          ),
        isMergeIncluded: () => Effect.succeed(true),
        deleteLocalBranch: (_repo, name, _force, onDeleting) =>
          Effect.sync(() => {
            onDeleting?.({ name, oid: branches.get(name) ?? "" });
            branches.delete(name);
          }),
        restoreDeletedBranch: (_repo, branch) =>
          Effect.sync(() => {
            branches.set(branch.name, branch.oid);
            restored.push(branch.name);
          }),
      },
      closure: Effect.fail(
        new HostOperationError({ operation: "task.close", message: "Closure failed" }),
      ),
    });

    await expect(Effect.runPromise(harness.service.completeDirectMerge(input))).rejects.toThrow(
      "Closure failed",
    );
    // The confirmation lists every related branch, so the close deletes each one.
    expect(restored.sort()).toEqual(["odt/task-1", "odt/task-1-retry"]);
    expect([...branches.keys()].sort()).toEqual(["odt/task-1", "odt/task-1-retry"]);
  });

  test("settles a committed closure during shutdown without restoring a deleted branch", async () => {
    const source = createSourceBranch();
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const harness = createHarness({
      gitOverrides: source.gitOverrides,
      closure: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    });
    const worker = Effect.runFork(harness.service.completeDirectMerge(input));
    await Effect.runPromise(Deferred.await(entered));
    const interrupted = Effect.runPromise(Fiber.interrupt(worker));
    Effect.runSync(Deferred.succeed(release, undefined));
    await interrupted;
    expect(harness.calls).toContain("closed");
    expect(source.exists()).toBe(false);
    expect(source.restores()).toBe(0);
    expect((await Effect.runPromise(harness.service.completeDirectMerge(input))).status).toBe(
      "closed",
    );
    expect(source.restores()).toBe(0);
  });

  test.each(["build", "qa", "spec", "planner"] as const)(
    "rejects a running %s session before cleanup",
    async (role) => {
      const { service, calls } = createHarness({
        role,
        countLiveSessions: ({ taskSessions }) => {
          expect(taskSessions[0]?.sessions[0]?.role).toBe(role);
          return Effect.succeed({ liveSessionCount: 1 });
        },
      });
      await expect(Effect.runPromise(service.completeDirectMerge(input))).rejects.toThrow(
        "Stop all running sessions",
      );
      expect(calls).not.toContain("cleanup");
      expect(calls).not.toContain("closed");
    },
  );

  test("propagates session check errors", async () => {
    const { service, calls } = createHarness({
      countLiveSessions: () =>
        Effect.fail(
          new HostOperationError({
            operation: "test.sessions",
            message: "Session state unavailable",
          }),
        ),
    });
    await expect(Effect.runPromise(service.completeDirectMerge(input))).rejects.toThrow(
      "Session state unavailable",
    );
    expect(calls).not.toContain("cleanup");
    expect(calls).not.toContain("closed");
  });

  test.each(["human_review", "blocked", "closed"] as const)(
    "completes according to the persisted %s status",
    async (status) => {
      const { service, calls } = createHarness({ status });
      const result = await Effect.runPromise(Effect.result(service.completeDirectMerge(input)));
      expect(result._tag).toBe(status === "blocked" ? "Failure" : "Success");
      expect(calls.filter((call) => call === "closed")).toHaveLength(
        status === "human_review" ? 1 : 0,
      );
      expect(calls.includes("cleanup")).toBe(status === "human_review");
    },
  );

  test("does not close after cleanup failure and releases the guard", async () => {
    const { service, calls, coordinator } = createHarness({
      cleanup: Effect.fail(
        new TerminalServiceError({
          code: "close_failed",
          operation: "close_by_task",
          message: "Cleanup failed",
        }),
      ),
    });
    await expect(Effect.runPromise(service.completeDirectMerge(input))).rejects.toThrow(
      "Cleanup failed",
    );
    expect(calls).not.toContain("closed");
    await Effect.runPromise(
      Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "start session")),
    );
  });

  test("excludes session start and blocker writes during Git checks", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const { service, coordinator } = createHarness({
            sync: Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ ahead: 0, behind: 0 }),
            ),
          });
          const completion = yield* Effect.forkScoped(service.completeDirectMerge(input));
          yield* Deferred.await(entered);
          const start = yield* Effect.result(
            Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "start session")),
          );
          const block = yield* Effect.result(
            service.buildBlocked({ ...input, reason: "Needs work" }),
          );
          expect(start._tag).toBe("Failure");
          expect(block._tag).toBe("Failure");
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(completion)).status).toBe("closed");
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
        }),
      ),
    );
  });
});
