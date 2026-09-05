import { Deferred, Effect, Fiber } from "effect";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { TerminalServiceError } from "../terminals/terminal-service";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildStartWorktreeFiles,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  task,
} from "./test-support/task-workflow-harness";

const input = { repoPath: "/repo", taskId: "task-1" };
const createHarness = ({
  countLiveSessions = () => Effect.succeed({ liveSessionCount: 0 }),
  sync = Effect.succeed({ ahead: 0, behind: 0 }),
  cleanup = Effect.void,
  status = "human_review",
  role = "build",
}: {
  countLiveSessions?: TaskActivityGuardPort["countLiveSessions"];
  sync?: ReturnType<GitPort["commitsAheadBehind"]>;
  cleanup?: Effect.Effect<void, TerminalServiceError>;
  status?: TaskCard["status"];
  role?: AgentSessionRecord["role"];
} = {}) => {
  const calls: unknown[] = [];
  const coordinator = createTaskSessionLifecycleCoordinator();
  let current = task({ status });
  const service = createTaskService({
    taskSessionLifecycleCoordinator: coordinator,
    taskActivityGuard: {
      countLiveSessions,
      cleanupTaskSessions: () => Effect.dieMessage("must not stop sessions"),
    },
    devServerService: createDirectMergeDevServerService(calls),
    terminalService: {
      acquireTaskCleanup: () =>
        Effect.sync(() => calls.push("cleanup")).pipe(
          Effect.zipRight(cleanup),
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
      { commitsAheadBehind: () => sync },
    ),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
    taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    taskStore: {
      listTasks: () => Effect.sync(() => [current]),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "" },
          plan: { markdown: "" },
          agentSessions: [createAgentSessionRecord({ role })],
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-09-05T10:00:00Z",
          },
        }),
      transitionTask: ({ status: nextStatus }) =>
        Effect.sync(() => {
          calls.push(nextStatus);
          current = { ...current, status: nextStatus };
          return current;
        }),
    },
  });
  return { service, calls, coordinator };
};

describe("direct merge completion session guard", () => {
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
      const result = await Effect.runPromise(Effect.either(service.completeDirectMerge(input)));
      expect(result._tag).toBe(status === "blocked" ? "Left" : "Right");
      expect(calls.filter((call) => call === "closed")).toHaveLength(
        status === "human_review" ? 1 : 0,
      );
      expect(calls.includes("cleanup")).toBe(status !== "blocked");
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
              Effect.zipRight(Deferred.await(release)),
              Effect.as({ ahead: 0, behind: 0 }),
            ),
          });
          const completion = yield* Effect.forkScoped(service.completeDirectMerge(input));
          yield* Deferred.await(entered);
          const start = yield* Effect.either(
            Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "start session")),
          );
          const block = yield* Effect.either(
            service.buildBlocked({ ...input, reason: "Needs work" }),
          );
          expect(start._tag).toBe("Left");
          expect(block._tag).toBe("Left");
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(completion)).status).toBe("closed");
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
        }),
      ),
    );
  });
});
