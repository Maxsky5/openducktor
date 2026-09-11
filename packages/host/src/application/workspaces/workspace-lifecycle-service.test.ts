import { describe, expect, mock, test } from "bun:test";
import {
  agentSessionRecordSchema,
  repoConfigSchema,
  taskCardSchema,
  type RepoConfig,
  type TaskCard,
  type TaskAgentSessions,
  type WorkspaceCatalog,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import type { GitPort } from "../../ports/git-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  createWorkspaceLifecycleService,
  type WorkspaceActivityPort,
} from "./workspace-lifecycle-service";

type TaskStoreDouble = Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">;

const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig =>
  repoConfigSchema.parse({
    workspaceId: "ws",
    workspaceName: "Workspace",
    repoPath: "/repos/ws",
    defaultRuntimeKind: "opencode",
    agentStudioState: { openTaskIds: [] },
    ...overrides,
  });

const catalog = (overrides: Partial<WorkspaceCatalog> = {}): WorkspaceCatalog => ({
  openWorkspaces: [],
  closedWorkspaces: [],
  onboardingCompleted: true,
  ...overrides,
});

const taskCard = (id: string): TaskCard =>
  taskCardSchema.parse({
    id,
    title: id,
    status: "open",
    issueType: "task",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

const session = (workingDirectory: string): TaskAgentSessions => ({
  taskId: "task-1",
  agentSessions: [
    agentSessionRecordSchema.parse({
      externalSessionId: "session-1",
      role: "build",
      startedAt: "2026-01-01T00:00:00.000Z",
      runtimeKind: "opencode",
      workingDirectory,
      selectedModel: null,
    }),
  ],
});

const createTaskStoreDouble = (
  tasks: TaskCard[] = [],
  sessions: TaskAgentSessions[] = [],
): TaskStoreDouble => ({
  listTasks: () => Effect.succeed(tasks),
  listAgentSessionsForTasks: () => Effect.succeed(sessions),
});

const noActivity: WorkspaceActivityPort = {
  inspect: () => Effect.succeed([]),
};

const activityWith = (
  blockers: Array<{ kind: "agent-session" | "dev-server" | "terminal"; label: string }>,
): WorkspaceActivityPort => ({ inspect: () => Effect.succeed(blockers) });

const createService = ({
  activity = noActivity,
  getRepoConfig = () => Effect.succeed(repoConfig()),
  getWorkspaceCatalog = () => Effect.succeed(catalog()),
  closeWorkspace = () => Effect.succeed(catalog()),
  removeWorkspaceRegistration = () => Effect.succeed(catalog()),
  removeWorkspaceData = () => Effect.void,
  taskStore = createTaskStoreDouble(),
  isRegisteredWorktree = () => Effect.succeed(true),
  removeWorktree = () => Effect.void,
  canonicalizePath = (path: string) => Effect.succeed(path),
  pathExists = () => Effect.succeed(true),
  resolvedPathKind = "descendant" as const,
}: {
  activity?: WorkspaceActivityPort;
  getRepoConfig?: () => Effect.Effect<RepoConfig, never>;
  getWorkspaceCatalog?: () => Effect.Effect<WorkspaceCatalog, never>;
  closeWorkspace?: () => Effect.Effect<WorkspaceCatalog, never>;
  removeWorkspaceRegistration?: () => Effect.Effect<WorkspaceCatalog, never>;
  removeWorkspaceData?: () => Effect.Effect<void, unknown>;
  taskStore?: TaskStoreDouble;
  isRegisteredWorktree?: () => Effect.Effect<boolean, never>;
  removeWorktree?: GitPort["removeWorktree"];
  canonicalizePath?: (path: string) => Effect.Effect<string, never>;
  pathExists?: () => Effect.Effect<boolean, never>;
  resolvedPathKind?: "descendant" | "outside";
} = {}) =>
  createWorkspaceLifecycleService({
    activity,
    gitPort: createGitPortTestDouble({
      canonicalizePath,
      isRegisteredWorktree,
      removeWorktree,
    }),
    settingsConfig: createSettingsConfigTestDouble({
      canonicalizePath,
      defaultWorktreeBasePath: (workspaceId) => `/managed/${workspaceId}`,
      join: (...paths) => paths.join("/").replaceAll(/\/+/g, "/"),
      pathExists,
      readConfig: () => Effect.succeed(null),
      resolveConfiguredPath: (path) => path,
    }),
    storage: { removeWorkspaceData },
    taskStore,
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getRepoConfig,
      getWorkspaceCatalog,
      closeWorkspace,
      removeWorkspaceRegistration,
    }),
    worktreeFiles: createWorktreeFilePortTestDouble({
      pathIsWithinRoot: () => Effect.succeed(false),
      removePathIfPresent: () => Effect.void,
      resolvePathWithinRoot: (_root, candidate) =>
        Effect.succeed({
          canonicalPath: candidate,
          cleanupPath: candidate,
          isSymlink: false,
          kind: resolvedPathKind,
        }),
      resolveWorktreePath: (_repoPath, worktreePath) => worktreePath,
    }),
  });

describe("workspace lifecycle service", () => {
  test("closeWorkspace rejects while work is running and does not persist", async () => {
    const closeWorkspace = mock(() => Effect.succeed(catalog()));
    const service = createService({
      activity: activityWith([
        { kind: "agent-session", label: "agent session session-1 is running" },
      ]),
      closeWorkspace,
    });

    await expect(
      Effect.runPromise(
        service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
      ),
    ).rejects.toThrow(
      "Stop the running work before closing or removing this workspace: agent session session-1 is running.",
    );
    expect(closeWorkspace).not.toHaveBeenCalled();
  });

  test("closeWorkspace delegates to settings when no work is running", async () => {
    const expected = catalog();
    const closeWorkspace = mock(() => Effect.succeed(expected));
    const service = createService({ closeWorkspace });

    const result = await Effect.runPromise(
      service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
    );

    expect(result).toEqual(expected);
    expect(closeWorkspace).toHaveBeenCalledWith("ws", "/repos/ws");
  });

  test("closeWorkspace returns the catalog for an already closed workspace without inspection", async () => {
    const inspect = mock(() => Effect.succeed([]));
    const expected = catalog();
    const service = createService({
      activity: { inspect },
      getRepoConfig: () => Effect.succeed(repoConfig({ closed: true })),
      getWorkspaceCatalog: () => Effect.succeed(expected),
    });

    const result = await Effect.runPromise(
      service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
    );

    expect(result).toEqual(expected);
    expect(inspect).not.toHaveBeenCalled();
  });

  test("removeWorkspace removes workspace data before unregistering", async () => {
    const calls: string[] = [];
    const service = createService({
      removeWorkspaceData: () =>
        Effect.sync(() => {
          calls.push("removeData");
        }),
      removeWorkspaceRegistration: () =>
        Effect.sync(() => {
          calls.push("unregister");
          return catalog();
        }),
    });

    const { result } = await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: false,
      }),
    );

    expect(calls).toEqual(["removeData", "unregister"]);
    expect(result.removedWorktrees).toEqual([]);
  });

  test("removeWorkspace blocks on running dev servers", async () => {
    const removeWorkspaceData = mock(() => Effect.void);
    const service = createService({
      activity: activityWith([{ kind: "dev-server", label: "dev server for task-1 is running" }]),
      removeWorkspaceData,
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("dev server for task-1 is running");
    expect(removeWorkspaceData).not.toHaveBeenCalled();
  });

  test("removeWorkspace removes verified task and historical session worktrees", async () => {
    const removed: Array<{ repoPath: string; worktreePath: string; force: boolean }> = [];
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")], [session("/custom/worktrees/task-1")]),
      getWorkspaceCatalog: () =>
        Effect.succeed(
          catalog({
            openWorkspaces: [
              {
                workspaceId: "ws",
                workspaceName: "Workspace",
                repoPath: "/repos/ws",
                isActive: true,
                hasConfig: true,
                configuredWorktreeBasePath: null,
                defaultWorktreeBasePath: "/managed/ws",
                effectiveWorktreeBasePath: "/managed/ws",
              },
            ],
          }),
        ),
      removeWorktree: (repoPath, worktreePath, force) =>
        Effect.sync(() => {
          removed.push({ repoPath, worktreePath, force });
        }),
    });

    const { result } = await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: true,
      }),
    );

    expect(removed).toEqual([
      { repoPath: "/repos/ws", worktreePath: "/managed/ws/task-1", force: true },
      { repoPath: "/repos/ws", worktreePath: "/custom/worktrees/task-1", force: true },
    ]);
    expect(result.removedWorktrees).toEqual(["/managed/ws/task-1", "/custom/worktrees/task-1"]);
  });

  test("removeWorkspace fails before cleanup when a candidate is not a registered worktree", async () => {
    const removeWorkspaceData = mock(() => Effect.void);
    const removeWorkspaceRegistration = mock(() => Effect.succeed(catalog()));
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")], [session("/custom/worktrees/task-1")]),
      isRegisteredWorktree: () => Effect.succeed(false),
      removeWorkspaceData,
      removeWorkspaceRegistration,
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("Cannot establish that");
    expect(removeWorkspaceData).not.toHaveBeenCalled();
    expect(removeWorkspaceRegistration).not.toHaveBeenCalled();
  });

  test("removeWorkspace keeps the registration when workspace data cleanup fails", async () => {
    const removeWorkspaceRegistration = mock(() => Effect.succeed(catalog()));
    const service = createService({
      removeWorkspaceData: () => Effect.fail(new Error("disk failure")),
      removeWorkspaceRegistration,
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: false,
        }),
      ),
    ).rejects.toThrow("Failed to remove the workspace task data");
    expect(removeWorkspaceRegistration).not.toHaveBeenCalled();
  });

  test("removeWorkspace reports completed worktrees when a later worktree fails", async () => {
    let removalCount = 0;
    const service = createService({
      taskStore: createTaskStoreDouble(
        [taskCard("task-1"), taskCard("task-2")],
        [session("/custom/worktrees/task-1"), session("/custom/worktrees/task-2")],
      ),
      removeWorktree: () => {
        removalCount += 1;
        return removalCount === 2
          ? Effect.fail(
              new HostOperationError({
                operation: "test.removeWorktree",
                message: "git worktree remove failed",
              }),
            )
          : Effect.void;
      },
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("Removed 1 task worktree(s)");
  });

  test("uses the expected repository path to reject a changed target before mutation", async () => {
    const closeWorkspace = mock(() => Effect.succeed(catalog()));
    const service = createService({ closeWorkspace });

    await expect(
      Effect.runPromise(
        service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/other" }),
      ),
    ).rejects.toThrow("changed since the dialog opened");
    expect(closeWorkspace).not.toHaveBeenCalled();
  });
});
