import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createTaskService,
  task,
  type TaskActivityGuardPort,
  type TaskStorePort,
} from "./test-support/task-workflow-harness";

type TestSession = ReturnType<typeof createAgentSessionRecord>;
type CountCall = { sessionIds: string[]; sessionRoles: string[] };

const metadataWithSessions = (agentSessions: TestSession[]) => ({
  spec: { markdown: "" },
  plan: { markdown: "" },
  agentSessions,
});

const createStopImpactTaskStore = (
  sessionsByTaskId: Record<string, TestSession[]>,
  tasks = Object.keys(sessionsByTaskId).map((id) => task({ id })),
): TaskStorePort => ({
  listTasks: () => Effect.succeed(tasks),
  getTaskMetadata(input) {
    return Effect.succeed(metadataWithSessions(sessionsByTaskId[input.taskId] ?? []));
  },
});

const makeGuard = (
  liveSessions: Set<string>,
  countCalls: CountCall[] = [],
): TaskActivityGuardPort => ({
  countLiveSessions(input) {
    return Effect.sync(() => {
      countCalls.push({
        sessionIds: input.taskSessions.flatMap((task) =>
          task.sessions.map((session) => session.externalSessionId),
        ),
        sessionRoles: [
          ...new Set(input.taskSessions.flatMap((task) => task.sessions.map((s) => s.role))),
        ],
      });
      return {
        liveSessionCount: input.taskSessions.reduce(
          (count, task) =>
            count +
            task.sessions.filter((session) => liveSessions.has(session.externalSessionId)).length,
          0,
        ),
      };
    });
  },
  cleanupTaskSessions() {
    return Effect.fail(new HostOperationError({ operation: "test", message: "unexpected stop" }));
  },
});

const createService = (
  sessionsByTaskId: Record<string, TestSession[]>,
  guard?: TaskActivityGuardPort,
  tasks?: ReturnType<typeof task>[],
) => {
  const input = {
    gitPort: createDirectMergeGitPort({ calls: [] }),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
    taskStore: createStopImpactTaskStore(sessionsByTaskId, tasks),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { preStart: [], postComplete: [] },
    }),
  };
  if (guard) {
    return createTaskService({ ...input, taskActivityGuard: guard });
  }
  return createTaskService(input);
};

describe("getTaskStopImpact", () => {
  test("previews zero without probing when tasks have no agent sessions", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const service = createService({}, makeGuard(new Set(["live-1"]), countCalls));

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "delete",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 0 });
    expect(countCalls).toEqual([]);
  });

  test("delete derives hidden descendants from the authoritative task graph", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const guard = makeGuard(new Set(["live-build"]), countCalls);
    const service = createService(
      {
        "task-1": [createAgentSessionRecord({ externalSessionId: "live-build" })],
        "task-2": [
          createAgentSessionRecord({
            externalSessionId: "idle-planner",
            role: "planner",
          }),
        ],
      },
      guard,
      [task({ id: "task-1" }), task({ id: "task-2", parentId: "task-1" })],
    );

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "delete",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 1 });
    expect(countCalls).toEqual([
      {
        sessionIds: ["live-build", "idle-planner"],
        sessionRoles: ["build", "planner"],
      },
    ]);
  });

  test("reset task previews every workflow-role session including repo-root planner sessions", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const guard = makeGuard(new Set(["root-planner"]), countCalls);
    const service = createService(
      {
        "task-1": [
          createAgentSessionRecord({
            externalSessionId: "root-planner",
            role: "planner",
          }),
          createAgentSessionRecord({
            externalSessionId: "idle-build",
            workingDirectory: "/worktrees/repo/task-1",
          }),
        ],
      },
      guard,
    );

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "reset_task",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 1 });
    expect(countCalls).toEqual([
      {
        sessionIds: ["root-planner", "idle-build"],
        sessionRoles: ["planner", "build"],
      },
    ]);
  });

  test("reset implementation ignores non-canonical spec and planner sessions that the host never targets", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const guard = makeGuard(new Set(["root-planner", "canonical-build"]), countCalls);
    const service = createService(
      {
        "task-1": [
          createAgentSessionRecord({
            externalSessionId: "root-planner",
            role: "planner",
            workingDirectory: "/repo",
          }),
          createAgentSessionRecord({
            externalSessionId: "canonical-build",
            role: "build",
            workingDirectory: "/worktrees/repo/task-1",
          }),
        ],
      },
      guard,
    );

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "reset_implementation",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 1 });
    expect(countCalls).toEqual([
      {
        sessionIds: ["canonical-build"],
        sessionRoles: ["build"],
      },
    ]);
  });

  test("reset implementation probes nothing when only non-guarded sessions exist", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const guard = makeGuard(new Set(["root-planner"]), countCalls);
    const service = createService(
      {
        "task-1": [
          createAgentSessionRecord({
            externalSessionId: "root-spec",
            role: "spec",
            workingDirectory: "/repo",
          }),
          createAgentSessionRecord({
            externalSessionId: "root-planner",
            role: "planner",
            workingDirectory: "/repo",
          }),
        ],
      },
      guard,
    );

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "reset_implementation",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 0 });
    expect(countCalls).toEqual([]);
  });

  test("duplicate task ids collapse to a single preview pass per task", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const guard = makeGuard(new Set(["live-build"]), countCalls);
    const service = createService(
      {
        "task-1": [createAgentSessionRecord({ externalSessionId: "live-build" })],
      },
      guard,
    );

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1", "task-1"],
        operation: "delete",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 1 });
    expect(countCalls).toEqual([
      {
        sessionIds: ["live-build"],
        sessionRoles: ["build"],
      },
    ]);
  });

  test("close previews workflow-role sessions for the single task", async () => {
    const countCalls: Array<{ sessionIds: string[]; sessionRoles: string[] }> = [];
    const guard = makeGuard(new Set(["live-qa"]), countCalls);
    const service = createService(
      {
        "task-1": [
          createAgentSessionRecord({
            externalSessionId: "live-qa",
            role: "qa",
          }),
        ],
      },
      guard,
    );

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "close",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 1 });
    expect(countCalls).toEqual([
      {
        sessionIds: ["live-qa"],
        sessionRoles: ["qa"],
      },
    ]);
  });

  test("fails with an actionable dependency error when a guard is required but missing", async () => {
    const service = createService({
      "task-1": [createAgentSessionRecord()],
    });

    await expect(
      Effect.runPromise(
        service.getTaskStopImpact({
          repoPath: "/repo",
          taskIds: ["task-1"],
          operation: "delete",
        }),
      ),
    ).rejects.toThrow("task_stop_impact_get requires runtime session activity checks");
  });

  test("skips the guard requirement when implementation reset has no guarded sessions", async () => {
    const service = createService({
      "task-1": [
        createAgentSessionRecord({
          externalSessionId: "root-spec",
          role: "spec",
          workingDirectory: "/repo",
        }),
      ],
    });

    const result = await Effect.runPromise(
      service.getTaskStopImpact({
        repoPath: "/repo",
        taskIds: ["task-1"],
        operation: "reset_implementation",
      }),
    );

    expect(result).toEqual({ stoppableSessionCount: 0 });
  });
});
