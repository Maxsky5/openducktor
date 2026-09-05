import { Deferred, Effect, Fiber } from "effect";
import type { GitPort } from "../../ports/git-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  task,
} from "./test-support/task-workflow-harness";

const mergeInput = {
  repoPath: "/repo",
  taskId: "task-1",
  input: { mergeMethod: "merge_commit" as const },
};

const createHarness = (
  countLiveSessions: TaskActivityGuardPort["countLiveSessions"],
  mergeBranch: ReturnType<GitPort["mergeBranch"]> = Effect.succeed({
    outcome: "merged",
    output: "merged",
  }),
  publish = true,
) => {
  const calls: unknown[] = [];
  const coordinator = createTaskSessionLifecycleCoordinator();
  let current = task({ status: "ai_review" });
  const service = createTaskService({
    taskSessionLifecycleCoordinator: coordinator,
    taskActivityGuard: {
      countLiveSessions,
      cleanupTaskSessions: () => Effect.dieMessage("must not stop sessions"),
    },
    devServerService: createDirectMergeDevServerService(calls),
    gitPort: extendGitPort(
      createDirectMergeGitPort({
        calls,
        currentBranches: { "/worktrees/repo/task-1": { name: "odt/task-1", detached: false } },
      }),
      {
        suggestedSquashCommitMessage: () => Effect.succeed("Merge task"),
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: { name: "odt/task-1", detached: false },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          }),
        mergeBranch: () =>
          Effect.sync(() => calls.push("merge")).pipe(Effect.zipRight(mergeBranch)),
      },
    ),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { preStart: [], postComplete: [] },
      defaultTargetBranch: publish ? { remote: "origin", branch: "main" } : { branch: "main" },
    }),
    taskStore: {
      listTasks: () => Effect.succeed([current]),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "" },
          plan: { markdown: "" },
          agentSessions: [createAgentSessionRecord()],
        }),
      setDirectMerge: () =>
        Effect.sync(() => {
          calls.push("record");
          return true;
        }),
      transitionTask: ({ status }) =>
        Effect.sync(() => {
          current = { ...current, status };
          calls.push(status);
          return current;
        }),
    },
  });
  return { service, coordinator, calls };
};

describe("direct merge session guard", () => {
  test("rejects a running task session before Git or task writes", async () => {
    const checked: unknown[] = [];
    const { service, calls } = createHarness((input) =>
      Effect.sync(() => {
        checked.push(input);
        return { liveSessionCount: 1 };
      }),
    );
    const result = await Effect.runPromise(Effect.either(service.directMerge(mergeInput)));
    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        message: "Stop all running sessions for task task-1 before direct merge.",
      },
    });
    expect(checked).toEqual([
      {
        repoPath: "/repo",
        taskSessions: [
          {
            taskId: "task-1",
            sessions: [createAgentSessionRecord()],
          },
        ],
      },
    ]);
    expect(calls).not.toContain("merge");
    expect(calls).not.toContain("record");
  });

  test("propagates a session check failure before Git mutation", async () => {
    const { service, calls } = createHarness(() =>
      Effect.fail(
        new HostOperationError({
          operation: "test.sessions",
          message: "Session state unavailable",
        }),
      ),
    );
    await expect(Effect.runPromise(service.directMerge(mergeInput))).rejects.toThrow(
      "Session state unavailable",
    );
    expect(calls).not.toContain("merge");
  });

  test.each([true, false])(
    "allows idle sessions and completes with publish=%s",
    async (publish) => {
      const { service } = createHarness(
        () => Effect.succeed({ liveSessionCount: 0 }),
        undefined,
        publish,
      );
      const result = await Effect.runPromise(service.directMerge(mergeInput));
      expect(result).toMatchObject({
        outcome: "completed",
        task: { status: publish ? "human_review" : "closed" },
      });
    },
  );

  test.each(["failure", "conflicts"])(
    "releases session exclusion after Git %s",
    async (outcome) => {
      const merge: ReturnType<GitPort["mergeBranch"]> =
        outcome === "failure"
          ? Effect.fail(
              new HostOperationError({ operation: "test.merge", message: "Merge failed" }),
            )
          : Effect.succeed({
              outcome: "conflicts",
              output: "Conflict",
              conflictedFiles: ["file.ts"],
            });
      const { service, coordinator, calls } = createHarness(
        () => Effect.succeed({ liveSessionCount: 0 }),
        merge,
      );
      const result = await Effect.runPromise(Effect.either(service.directMerge(mergeInput)));
      expect(result._tag).toBe(outcome === "failure" ? "Left" : "Right");
      expect(calls).not.toContain("record");
      await Effect.runPromise(
        Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "start session")),
      );
    },
  );

  test("rejects direct merge while session startup is in progress", async () => {
    const { service, coordinator, calls } = createHarness(() =>
      Effect.succeed({ liveSessionCount: 0 }),
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
          const result = yield* Effect.either(service.directMerge(mergeInput));
          expect(result._tag).toBe("Left");
          expect(calls).not.toContain("merge");
        }),
      ),
    );
  });

  test("excludes session start and resume until the merge finishes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const { service, coordinator } = createHarness(
            () => Effect.succeed({ liveSessionCount: 0 }),
            Deferred.succeed(entered, undefined).pipe(
              Effect.zipRight(Deferred.await(release)),
              Effect.as({ outcome: "merged" as const, output: "merged" }),
            ),
          );
          const merge = yield* Effect.forkScoped(service.directMerge(mergeInput));
          yield* Deferred.await(entered);
          const bootstrap = yield* Effect.either(
            coordinator.acquireLifecycle("/repo", ["task-1"], "start session"),
          );
          const resume = yield* Effect.either(
            Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "resume session")),
          );
          expect(bootstrap._tag).toBe("Left");
          expect(resume._tag).toBe("Left");
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(merge);
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
        }),
      ),
    );
  });
});
