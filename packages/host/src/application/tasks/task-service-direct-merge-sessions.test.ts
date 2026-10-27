import { builtinTaskWorkflows } from "../../test-support/task-workflows";
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
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  task,
} from "./test-support/task-workflow-harness";

const mergeInput = {
  repoPath: "/repo",
  taskId: "task-1",
  input: {
    mergeMethod: "merge_commit" as const,
    expected: {
      taskStatus: "ai_review" as const,
      sourceBranch: "odt/task-1",
      targetBranch: { remote: "origin", branch: "main" },
    },
  },
};

const createHarness = (
  countLiveSessions: TaskActivityGuardPort["countLiveSessions"],
  mergeBranch: ReturnType<GitPort["mergeBranch"]> = Effect.succeed({
    outcome: "merged",
    output: "merged",
  }),
  publish = true,
  recording: Effect.Effect<void> = Effect.void,
) => {
  const calls: unknown[] = [];
  const coordinator = createTaskSessionLifecycleCoordinator();
  let current = task({ status: "ai_review" });
  const service = createTaskService({
    taskWorkflows: builtinTaskWorkflows,
    taskSessionLifecycleCoordinator: coordinator,
    taskActivityGuard: {
      countLiveSessions,
      // Completion stops nothing: it checked that no session runs. It releases the idle ones.
      cleanupTaskSessions: () => Effect.succeed({ stoppedSessionCount: 0 }),
    },
    gitPort: extendGitPort(
      createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/repo": { name: "main", detached: false, revision: "a".repeat(40) },
          "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
        },
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
        mergeBranch: (_repoPath, request) =>
          Effect.sync(() => {
            request.onWorkIssued?.();
            calls.push("merge");
          }).pipe(Effect.andThen(mergeBranch)),
      },
    ),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { postComplete: [] },
      defaultTargetBranch: publish ? { remote: "origin", branch: "main" } : { branch: "main" },
    }),
    taskStore: {
      listTasks: () => Effect.succeed([current]),
      getTaskMetadata: () =>
        Effect.succeed({
          artifacts: {},
          agentSessions: [createAgentSessionRecord()],
        }),
      setDirectMerge: () =>
        recording.pipe(
          Effect.andThen(
            Effect.sync(() => {
              calls.push("record");
              return true;
            }),
          ),
        ),
      transitionTask: ({ status }) =>
        Effect.sync(() => {
          current = { ...current, status };
          calls.push(status);
          return current;
        }),
    },
  });
  return {
    service,
    coordinator,
    calls,
    mergeInput: {
      ...mergeInput,
      input: {
        ...mergeInput.input,
        expected: {
          ...mergeInput.input.expected,
          targetBranch: publish ? { remote: "origin", branch: "main" } : { branch: "main" },
        },
      },
    },
  };
};

describe("direct merge session guard", () => {
  test("commits the confirmed native merge record when shutdown interrupts its settlement", async () => {
    const recording = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const harness = createHarness(
      () => Effect.succeed({ liveSessionCount: 0 }),
      Effect.succeed({ outcome: "merged", output: "merged" }),
      true,
      Deferred.succeed(recording, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );
    const worker = Effect.runFork(harness.service.directMerge(harness.mergeInput));
    await Effect.runPromise(Deferred.await(recording));
    const interrupted = Effect.runPromise(Fiber.interrupt(worker));
    Effect.runSync(Deferred.succeed(release, undefined));
    await interrupted;
    expect(harness.calls.filter((call) => call === "merge")).toHaveLength(1);
    expect(harness.calls.filter((call) => call === "record")).toHaveLength(1);
    await Effect.runPromise(
      Effect.scoped(harness.coordinator.acquireLifecycle("/repo", ["task-1"], "next operation")),
    );
  });

  test("rejects a running task session before Git or task writes", async () => {
    const checked: unknown[] = [];
    const { mergeInput, service, calls } = createHarness((input) =>
      Effect.sync(() => {
        checked.push(input);
        return { liveSessionCount: 1 };
      }),
    );
    const result = await Effect.runPromise(Effect.result(service.directMerge(mergeInput)));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
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
    const { mergeInput, service, calls } = createHarness(() =>
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
      const { service, mergeInput } = createHarness(
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

  test("an issued merge with no result cannot apply a second merge", async () => {
    const { service, mergeInput, calls } = createHarness(
      () => Effect.succeed({ liveSessionCount: 0 }),
      Effect.fail(
        new HostOperationError({
          operation: "test.merge",
          message: "Connection ended after dispatch",
        }),
      ),
    );
    await expect(Effect.runPromise(service.directMerge(mergeInput))).rejects.toThrow(
      "Do not apply another merge",
    );
    await expect(Effect.runPromise(service.directMerge(mergeInput))).rejects.toThrow(
      "original merge has no conclusive result",
    );
    expect(calls.filter((call) => call === "merge")).toHaveLength(1);
  });

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
      const { mergeInput, service, coordinator, calls } = createHarness(
        () => Effect.succeed({ liveSessionCount: 0 }),
        merge,
      );
      const result = await Effect.runPromise(Effect.result(service.directMerge(mergeInput)));
      expect(result._tag).toBe(outcome === "failure" ? "Failure" : "Success");
      expect(calls).not.toContain("record");
      await Effect.runPromise(
        Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "start session")),
      );
    },
  );

  test("rejects direct merge while session startup is in progress", async () => {
    const { mergeInput, service, coordinator, calls } = createHarness(() =>
      Effect.succeed({ liveSessionCount: 0 }),
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
          const result = yield* Effect.result(service.directMerge(mergeInput));
          expect(result._tag).toBe("Failure");
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
          const { mergeInput, service, coordinator } = createHarness(
            () => Effect.succeed({ liveSessionCount: 0 }),
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ outcome: "merged" as const, output: "merged" }),
            ),
          );
          const merge = yield* Effect.forkScoped(service.directMerge(mergeInput));
          yield* Deferred.await(entered);
          const bootstrap = yield* Effect.result(
            coordinator.acquireLifecycle("/repo", ["task-1"], "start session"),
          );
          const resume = yield* Effect.result(
            Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "resume session")),
          );
          expect(bootstrap._tag).toBe("Failure");
          expect(resume._tag).toBe("Failure");
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(merge);
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
        }),
      ),
    );
  });
});
