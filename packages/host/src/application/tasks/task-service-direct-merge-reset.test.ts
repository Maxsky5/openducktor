import type {
  DirectMergeRecord,
  TaskCompletionObservation,
  TaskMetadataPayload,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GitPort } from "../../ports/git-port";
import { createDefaultGitRunner } from "../../infrastructure/git/git-command-runner";
import { isMergeIncluded, mergeBranch } from "../../infrastructure/git/git-merge";
import { getCurrentBranchUnchecked } from "../../infrastructure/git/git-status";
import { HostOperationError } from "../../effect/host-errors";
import { TerminalServiceError } from "../terminals/terminal-service";
import { createLiveWorkflowObservations } from "../agent-sessions/live-workflow-observations";
import {
  createBuildSettingsConfig,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskServiceWithMutationProgress,
  extendGitPort,
  task,
} from "./test-support/task-workflow-harness";

const input = { repoPath: "/repo", taskId: "task-1" };
const mergeInput = {
  ...input,
  input: {
    mergeMethod: "merge_commit" as const,
    expected: {
      taskStatus: "human_review" as const,
      sourceBranch: "odt/task-1",
      targetBranch: { branch: "main" },
    },
  },
};
type ResetFailure = "none" | "clear merge" | "transition" | "publish";

const createHarness = (
  afterMergeClear: Effect.Effect<void> = Effect.void,
  gitOverrides: Partial<GitPort> = {},
) => {
  const calls: unknown[] = [];
  const observations: TaskCompletionObservation[] = [];
  const live = createLiveWorkflowObservations();
  let current = task({ status: "human_review", targetBranch: { branch: "main" } });
  let directMerge: DirectMergeRecord | undefined;
  let mergeCalls = 0;
  let inclusionChecks = 0;
  let targetIncludesMerge = true;
  let recordFailed = false;
  let cleanupCalls = 0;
  let cleanupFailed = true;
  let resetFailure: ResetFailure = "none";
  const serviceInput: Parameters<typeof createTaskServiceWithMutationProgress>[0] = {
    publishCompletion: (observation) =>
      Effect.gen(function* () {
        observations.push(observation);
        live.accept({ type: "task_completion_updated", observation });
        if (resetFailure === "publish")
          return yield* new HostOperationError({
            operation: "test.publish",
            message: "Reset observation publication failed",
          });
      }),
    terminalService: {
      acquireTaskCleanup: () =>
        Effect.suspend(() => {
          cleanupCalls += 1;
          return cleanupFailed
            ? Effect.fail(
                new TerminalServiceError({
                  code: "close_failed",
                  operation: "close_by_task",
                  message: "Completion cleanup failed",
                }),
              )
            : Effect.succeed({ closedTerminalIds: [] });
        }),
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
        isMergeIncluded: () =>
          Effect.sync(() => {
            inclusionChecks += 1;
            return targetIncludesMerge;
          }),
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: { name: "odt/task-1", detached: false },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          }),
        suggestedSquashCommitMessage: () => Effect.succeed("Merge task work"),
        mergeBranch: () =>
          Effect.sync(() => {
            mergeCalls += 1;
            return { outcome: "merged" as const, output: `Merged build ${mergeCalls}` };
          }),
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
      defaultTargetBranch: { branch: "main" },
    }),
    taskStore: {
      listTasks: () => Effect.sync(() => [current]),
      getTaskMetadata: () =>
        Effect.sync(() => {
          const metadata: TaskMetadataPayload = {
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
            agentSessions: [],
          };
          if (directMerge) metadata.directMerge = directMerge;
          return metadata;
        }),
      clearWorkflowDocuments: () => Effect.succeed(true),
      clearAgentSessionsByRoles: () => Effect.succeed(true),
      clearQaReports: () => Effect.succeed(true),
      setPullRequest: () => Effect.succeed(true),
      setDirectMerge: ({ directMerge: nextMerge }) =>
        Effect.gen(function* () {
          if (nextMerge !== null && recordFailed)
            return yield* new HostOperationError({
              operation: "test.recordMerge",
              message: "Merge record save failed",
            });
          if (nextMerge === null && resetFailure === "clear merge")
            return yield* new HostOperationError({
              operation: "test.clearMerge",
              message: "Merge record clear failed",
            });
          directMerge = nextMerge ?? undefined;
          if (nextMerge === null) yield* afterMergeClear;
          return true;
        }),
      transitionTask: ({ status }) =>
        Effect.gen(function* () {
          if (resetFailure === "transition")
            return yield* new HostOperationError({
              operation: "test.transition",
              message: "Reset transition failed",
            });
          current = { ...current, status };
          return current;
        }),
    },
  };
  const createService = () => createTaskServiceWithMutationProgress(serviceInput);
  return {
    service: createService(),
    restart: createService,
    observations,
    live,
    mergeCalls: () => mergeCalls,
    inclusionChecks: () => inclusionChecks,
    cleanupCalls: () => cleanupCalls,
    status: () => current.status,
    failRecord: (failed: boolean) => {
      recordFailed = failed;
    },
    includeMerge: (included: boolean) => {
      targetIncludesMerge = included;
    },
    directMerge: () => directMerge,
    allowCleanup: () => {
      cleanupFailed = false;
    },
    failReset: (failure: ResetFailure) => {
      resetFailure = failure;
    },
    rebuild: () => {
      current = { ...current, status: "human_review" };
    },
  };
};

describe("task completion recovery and reset", () => {
  test.each(["merge_commit", "squash", "rebase"] as const)(
    "%s recovery retains applied content evidence and blocks a target revert",
    async (method) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "odt-task-merge-recovery-"));
      const repo = path.join(directory, "repo");
      const worktree = path.join(directory, "source");
      const runner = createDefaultGitRunner(
        () => ({ ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }),
        { command: "git" },
      );
      const git = (cwd: string, ...args: string[]) => Effect.runPromise(runner(cwd, args));
      try {
        await git(directory, "init", "--initial-branch=main", repo);
        await git(repo, "config", "user.name", "Recovery test");
        await git(repo, "config", "user.email", "recovery@example.invalid");
        await writeFile(path.join(repo, "base"), "base");
        await git(repo, "add", ".");
        await git(repo, "commit", "-m", "Base");
        await git(repo, "switch", "-c", "odt/task-1");
        await writeFile(path.join(repo, "change"), "task change");
        await git(repo, "add", ".");
        await git(repo, "commit", "-m", "Task");
        await git(repo, "switch", "main");
        await writeFile(path.join(repo, "target-only"), "Existing target content");
        await git(repo, "add", ".");
        await git(repo, "commit", "-m", "Target work");
        await git(repo, "worktree", "add", worktree, "odt/task-1");
        let appliedTargetOid: string | undefined;
        let nativeMerges = 0;
        const verifiedEvidence: Array<string | undefined> = [];
        const harness = createHarness(Effect.void, {
          canonicalizePath: (cwd) => Effect.succeed(cwd === "/repo-alias" ? "/repo" : cwd),
          getCurrentBranch: (cwd) =>
            getCurrentBranchUnchecked(runner, cwd === "/repo" ? repo : worktree),
          mergeBranch: (_cwd, request) => {
            nativeMerges += 1;
            return mergeBranch(runner, repo, {
              ...request,
              sourceWorkingDirectory: worktree,
              onApplied: (oid) => {
                appliedTargetOid = oid;
                request.onApplied?.(oid);
              },
            });
          },
          isMergeIncluded: (_cwd, source, target, evidence) => {
            verifiedEvidence.push(evidence);
            return isMergeIncluded(runner, repo, source, target, evidence);
          },
        });
        harness.allowCleanup();
        harness.failRecord(true);
        const intent = {
          ...mergeInput,
          input: { ...mergeInput.input, mergeMethod: method, squashCommitMessage: "Squash task" },
        };
        expect(
          await Effect.runPromise(harness.service.directMerge(intent).pipe(Effect.flip)),
        ).toMatchObject({
          failure: { message: "Merge record save failed" },
        });
        expect(appliedTargetOid).toBe((await git(repo, "rev-parse", "HEAD")).stdout.trim());
        await git(repo, "rm", "change");
        await git(repo, "commit", "-m", "Revert task content");
        if (method !== "squash")
          expect((await git(repo, "merge-base", "--is-ancestor", "odt/task-1", "HEAD")).ok).toBe(
            true,
          );
        harness.failRecord(false);
        expect(
          await Effect.runPromise(harness.service.directMerge(intent).pipe(Effect.flip)),
        ).toMatchObject({
          failure: {
            message: expect.stringContaining("cannot confirm that the current target retains"),
          },
        });
        expect(verifiedEvidence).toEqual([appliedTargetOid]);
        expect(harness.directMerge()).toBeDefined();
        expect(nativeMerges).toBe(1);
        expect(harness.cleanupCalls()).toBe(0);
        expect((await git(repo, "show", "odt/task-1:change")).stdout).toBe("task change");
        const sourceOid = (await git(repo, "rev-parse", "odt/task-1")).stdout.trim();
        await git(repo, "update-ref", "refs/heads/odt/task-1", "HEAD");
        const restarted = harness.restart();
        expect(
          await Effect.runPromise(Effect.result(restarted.completeDirectMerge(input))),
        ).toMatchObject({
          _tag: "Failure",
          failure: {
            failure: {
              message: expect.stringContaining(
                "Original applied merge commit evidence is unavailable",
              ),
            },
          },
        });
        expect(harness.directMerge()).toBeDefined();
        expect(harness.cleanupCalls()).toBe(0);
        expect(nativeMerges).toBe(1);
        expect(harness.status()).toBe("human_review");
        expect((await git(repo, "rev-parse", "odt/task-1^{tree}")).stdout).toBe(
          (await git(repo, "rev-parse", "HEAD^{tree}")).stdout,
        );
        await git(repo, "update-ref", "refs/heads/odt/task-1", sourceOid);
        await writeFile(path.join(repo, "change"), "task change");
        await git(repo, "add", ".");
        await git(repo, "commit", "-m", "Restore task content");
        expect(
          await Effect.runPromise(
            harness.service.completeDirectMerge({
              ...input,
              repoPath: "/repo-alias",
            }),
          ),
        ).toMatchObject({
          status: "closed",
        });
        expect(verifiedEvidence).toEqual([appliedTargetOid, undefined, appliedTargetOid]);
        expect(nativeMerges).toBe(1);
        expect(harness.cleanupCalls()).toBe(1);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    // Real Git setup, merge, revert, and recovery run dozens of processes on Windows.
    20_000,
  );

  test("retained merge recovery blocks cleanup when the target loses its content", async () => {
    const harness = createHarness();
    harness.allowCleanup();
    harness.failRecord(true);
    const first = await Effect.runPromise(
      harness.service.directMerge(mergeInput).pipe(Effect.flip),
    );
    expect(first).toMatchObject({
      _tag: "TaskMutationProgressFailure",
      failure: { message: "Merge record save failed" },
    });
    expect(harness.directMerge()).toBeUndefined();
    harness.failRecord(false);
    harness.includeMerge(false);
    const retry = await Effect.runPromise(
      harness.service.directMerge(mergeInput).pipe(Effect.flip),
    );
    expect(retry).toMatchObject({
      _tag: "TaskMutationProgressFailure",
      failure: {
        message: expect.stringContaining("cannot confirm that the current target retains"),
      },
    });
    expect(harness.directMerge()).toBeDefined();
    expect(harness.mergeCalls()).toBe(1);
    expect(harness.inclusionChecks()).toBeGreaterThan(0);
    expect(harness.cleanupCalls()).toBe(0);
    expect(harness.live.snapshot(input.repoPath).taskCompletions[0]).toMatchObject({
      failure: {
        message: expect.stringContaining("cannot confirm that the current target retains"),
      },
    });
    harness.includeMerge(true);
    expect(await Effect.runPromise(harness.service.completeDirectMerge(input))).toMatchObject({
      status: "closed",
    });
    expect(harness.mergeCalls()).toBe(1);
    expect(harness.cleanupCalls()).toBe(1);
    expect(
      harness.observations.filter(
        (observation) =>
          observation.phase === "settled" &&
          observation.cleanupCompleted &&
          observation.taskClosed &&
          !observation.failure,
      ),
    ).toHaveLength(1);
    expect(harness.live.snapshot(input.repoPath).taskCompletions).toEqual([]);
  });

  for (const reset of ["resetTask", "resetImplementation"] as const) {
    test.each(["none", "clear merge", "transition", "publish"] as const)(
      `${reset} invalidates completion at the committed merge clear: %s`,
      async (failure) => {
        const harness = createHarness();
        const first = await Effect.runPromise(
          harness.service.directMerge(mergeInput).pipe(Effect.flip),
        );
        expect(first).toMatchObject({
          _tag: "TaskMutationProgressFailure",
          failure: { message: expect.stringContaining("Completion cleanup failed") },
        });
        expect(harness.directMerge()).toBeDefined();
        expect(harness.mergeCalls()).toBe(1);
        const priorObservations = structuredClone(harness.observations);
        const priorLive = harness.live.snapshot(input.repoPath).taskCompletions;
        expect(priorLive[0]?.failure?.stage).toBe("cleanup");

        harness.allowCleanup();
        harness.failReset(failure);
        const result = await Effect.runPromise(Effect.result(harness.service[reset](input)));
        if (failure === "none") expect(result._tag).toBe("Success");
        else
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "TaskMutationProgressFailure" },
          });
        if (failure === "clear merge") {
          expect(harness.directMerge()).toBeDefined();
          expect(harness.observations).toEqual(priorObservations);
          expect(harness.live.snapshot(input.repoPath).taskCompletions).toEqual(priorLive);
          harness.failReset("none");
          await Effect.runPromise(harness.service[reset](input));
        }
        expect(harness.directMerge()).toBeUndefined();
        const resetObservations = harness.live.snapshot(input.repoPath).taskCompletions;

        harness.failReset("none");
        harness.rebuild();
        const rebuilt = await Effect.runPromise(harness.service.directMerge(mergeInput));
        expect(rebuilt).toMatchObject({ outcome: "completed", task: { status: "closed" } });
        expect(harness.mergeCalls()).toBe(2);
        expect(resetObservations).toEqual([]);
      },
    );
    test(`${reset} settles committed invalidation before releasing its lifecycle guard on interruption`, async () => {
      const entered = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      const harness = createHarness(
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      );
      await Effect.runPromise(harness.service.directMerge(mergeInput).pipe(Effect.flip));
      harness.allowCleanup();
      const worker = Effect.runFork(harness.service[reset](input));
      await Effect.runPromise(Deferred.await(entered));
      expect(harness.directMerge()).toBeUndefined();
      const conflicting = await Effect.runPromise(
        harness.service.directMerge(mergeInput).pipe(Effect.flip),
      );
      expect(conflicting).toMatchObject({
        message: expect.stringContaining("another lifecycle operation"),
      });
      expect(harness.mergeCalls()).toBe(1);
      const interrupted = Effect.runPromise(Fiber.interrupt(worker));
      Effect.runSync(Deferred.succeed(release, undefined));
      await interrupted;
      expect(harness.live.snapshot(input.repoPath).taskCompletions).toEqual([]);
      harness.rebuild();
      expect(await Effect.runPromise(harness.service.directMerge(mergeInput))).toMatchObject({
        outcome: "completed",
        task: { status: "closed" },
      });
      expect(harness.mergeCalls()).toBe(2);
    });
  }
});
