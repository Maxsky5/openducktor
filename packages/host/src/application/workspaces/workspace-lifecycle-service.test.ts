import { describe, expect, mock, test } from "bun:test";
import {
  agentSessionRecordSchema,
  repoConfigSchema,
  taskCardSchema,
  type RepoConfig,
  type TaskCard,
  type TaskAgentSessions,
  type WorkspaceCatalog,
  type WorkspaceRemovalRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { GitPort } from "../../ports/git-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import type { WorkspaceAdmissionService } from "./workspace-admission-service";
import type { WorkspaceActivityPort } from "./workspace-activity-inspector";
import {
  createWorkspaceLifecycleService,
  type WorkspaceStoragePort,
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
  incompleteRemovals: [],
  onboardingCompleted: true,
  ...overrides,
});

const removalRecord = (
  overrides: Partial<WorkspaceRemovalRecord> = {},
): WorkspaceRemovalRecord => ({
  version: 1,
  operationId: "op-1",
  removeTaskWorktrees: true,
  phase: "worktrees",
  removedWorktrees: [],
  pendingWorktreePath: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  lastFailure: null,
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
  releaseWorkspaceSessions: () => Effect.void,
};

const activityWith = (
  blockers: Array<{ kind: "agent-session" | "dev-server" | "terminal"; label: string }>,
  releaseWorkspaceSessions: WorkspaceActivityPort["releaseWorkspaceSessions"] = () => Effect.void,
): WorkspaceActivityPort => ({
  inspect: () => Effect.succeed(blockers),
  releaseWorkspaceSessions,
});

const createAdmissionDouble = (): Pick<
  WorkspaceAdmissionService,
  | "awaitWorkStarts"
  | "blockWorkspace"
  | "forgetWorkspace"
  | "releaseReservation"
  | "reserveWorkspace"
  | "unblockWorkspace"
  | "withAdministrativeAccess"
> => ({
  blockWorkspace: () => {},
  forgetWorkspace: () => {},
  releaseReservation: () => {},
  reserveWorkspace: () => Effect.void,
  unblockWorkspace: () => {},
  awaitWorkStarts: () => Effect.void,
  withAdministrativeAccess: (_workspaceId, effect) => effect,
});

const createService = ({
  activity = noActivity,
  admission = createAdmissionDouble(),
  getRepoConfig = () => Effect.succeed(repoConfig()),
  getWorkspaceCatalog = () => Effect.succeed(catalog()),
  closeWorkspace = () => Effect.succeed(catalog()),
  reopenWorkspace = () => Effect.succeed(catalog()),
  beginWorkspaceRemoval = (input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }) =>
    Effect.succeed({
      record: removalRecord({
        removeTaskWorktrees: input.removeTaskWorktrees,
        phase: input.removeTaskWorktrees ? "worktrees" : "task_store",
      }),
      repoConfig: repoConfig(),
    }),
  recordWorkspaceRemovalProgress = () => Effect.void,
  removeWorkspaceRegistration = () => Effect.succeed(catalog()),
  removeWorkspaceTaskAssets = () => Effect.void,
  removeWorkspaceTaskStore = () => Effect.void,
  assertPermanentRemovalSupported = () => Effect.void,
  taskStore = createTaskStoreDouble(),
  listWorktrees = () => Effect.succeed([]),
  isRegisteredWorktree = () => Effect.succeed(true),
  removeWorktree = () => Effect.void,
  canonicalizePath = (path: string) => Effect.succeed(path),
  pathExists = () => Effect.succeed(true),
  resolvedPathKind = "descendant" as const,
}: {
  activity?: WorkspaceActivityPort;
  admission?: ReturnType<typeof createAdmissionDouble>;
  getRepoConfig?: () => Effect.Effect<RepoConfig, never>;
  getWorkspaceCatalog?: () => Effect.Effect<WorkspaceCatalog, never>;
  closeWorkspace?: () => Effect.Effect<WorkspaceCatalog, never>;
  reopenWorkspace?: () => Effect.Effect<WorkspaceCatalog, never>;
  beginWorkspaceRemoval?: (input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }) => Effect.Effect<{ record: WorkspaceRemovalRecord; repoConfig: RepoConfig }, never>;
  recordWorkspaceRemovalProgress?: (input: {
    workspaceId: string;
    phase: "worktrees" | "attachments" | "task_store";
    removedWorktrees: string[];
    lastFailure: string | null;
    pendingWorktreePath: string | null | undefined;
  }) => Effect.Effect<void, never>;
  removeWorkspaceRegistration?: () => Effect.Effect<WorkspaceCatalog, never>;
  removeWorkspaceTaskAssets?: WorkspaceStoragePort["removeWorkspaceTaskAssets"];
  removeWorkspaceTaskStore?: WorkspaceStoragePort["removeWorkspaceTaskStore"];
  assertPermanentRemovalSupported?: WorkspaceStoragePort["assertPermanentRemovalSupported"];
  taskStore?: TaskStoreDouble;
  listWorktrees?: GitPort["listWorktrees"];
  isRegisteredWorktree?: () => Effect.Effect<boolean, never>;
  removeWorktree?: GitPort["removeWorktree"];
  canonicalizePath?: (path: string) => Effect.Effect<string, never>;
  pathExists?: (path: string) => Effect.Effect<boolean, never>;
  resolvedPathKind?: "descendant" | "outside";
} = {}) => {
  const storage: WorkspaceStoragePort = {
    assertPermanentRemovalSupported,
    removeWorkspaceTaskAssets,
    removeWorkspaceTaskStore,
  };
  return createWorkspaceLifecycleService({
    activity,
    admission,
    gitPort: createGitPortTestDouble({
      canonicalizePath,
      isRegisteredWorktree,
      listWorktrees,
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
    storage,
    taskStore,
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getRepoConfig,
      getWorkspaceCatalog,
      closeWorkspace,
      reopenWorkspace,
      beginWorkspaceRemoval,
      recordWorkspaceRemovalProgress,
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
};

describe("workspace lifecycle service", () => {
  test("closeWorkspace rejects while work is running and does not persist", async () => {
    const closeWorkspace = mock(() => Effect.succeed(catalog()));
    const blockWorkspace = mock(() => {});
    const service = createService({
      activity: activityWith([
        { kind: "agent-session", label: "agent session session-1 is running" },
      ]),
      admission: { ...createAdmissionDouble(), blockWorkspace },
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
    expect(blockWorkspace).not.toHaveBeenCalled();
  });

  test("closeWorkspace delegates and blocks further task work", async () => {
    const expected = catalog();
    const closeWorkspace = mock(() => Effect.succeed(expected));
    const blockWorkspace = mock(() => {});
    const service = createService({
      admission: { ...createAdmissionDouble(), blockWorkspace },
      closeWorkspace,
    });

    const result = await Effect.runPromise(
      service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
    );

    expect(result).toEqual(expected);
    expect(closeWorkspace).toHaveBeenCalledWith("ws", "/repos/ws");
    expect(blockWorkspace).toHaveBeenCalledWith({
      reason: "closed",
      repoPath: "/repos/ws",
      workspaceId: "ws",
    });
  });

  test("closeWorkspace returns the catalog for an already closed workspace without inspection", async () => {
    const inspect = mock(() => Effect.succeed([]));
    const expected = catalog();
    const service = createService({
      activity: { inspect, releaseWorkspaceSessions: () => Effect.void },
      getRepoConfig: () => Effect.succeed(repoConfig({ closed: true })),
      getWorkspaceCatalog: () => Effect.succeed(expected),
    });

    const result = await Effect.runPromise(
      service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
    );

    expect(result).toEqual(expected);
    expect(inspect).not.toHaveBeenCalled();
  });

  test("removeWorkspace writes the removal record before deleting data", async () => {
    const calls: string[] = [];
    const service = createService({
      beginWorkspaceRemoval: (input) => {
        calls.push("beginRemoval");
        return Effect.succeed({
          record: removalRecord({
            removeTaskWorktrees: input.removeTaskWorktrees,
            phase: input.removeTaskWorktrees ? "worktrees" : "task_store",
          }),
          repoConfig: repoConfig(),
        });
      },
      removeWorkspaceTaskAssets: () =>
        Effect.sync(() => {
          calls.push("removeAssets");
        }),
      removeWorkspaceTaskStore: () =>
        Effect.sync(() => {
          calls.push("removeTaskStore");
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

    expect(calls).toEqual(["beginRemoval", "removeTaskStore", "removeAssets", "unregister"]);
    expect(result.removedWorktrees).toEqual([]);
  });

  test("removeWorkspace records progress and blocks task work before deleting", async () => {
    const progress: Array<{ phase: string; lastFailure: string | null }> = [];
    const blockWorkspace = mock(() => {});
    const service = createService({
      admission: { ...createAdmissionDouble(), blockWorkspace },
      recordWorkspaceRemovalProgress: (input) =>
        Effect.sync(() => {
          progress.push({ phase: input.phase, lastFailure: input.lastFailure });
        }),
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: false,
      }),
    );

    expect(progress).toEqual([{ phase: "attachments", lastFailure: null }]);
    expect(blockWorkspace).toHaveBeenCalledWith({
      reason: "removal",
      repoPath: "/repos/ws",
      workspaceId: "ws",
    });
  });

  test("removeWorkspace blocks on running dev servers", async () => {
    const beginWorkspaceRemoval = mock(() =>
      Effect.succeed({ record: removalRecord({ phase: "attachments" }), repoConfig: repoConfig() }),
    );
    const service = createService({
      activity: activityWith([{ kind: "dev-server", label: "dev server for task-1 is running" }]),
      beginWorkspaceRemoval,
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
    expect(beginWorkspaceRemoval).not.toHaveBeenCalled();
  });

  test("removeWorkspace rejects a configured task store before journaling and worktree removal", async () => {
    const beginWorkspaceRemoval = mock(() =>
      Effect.succeed({ record: removalRecord({ phase: "worktrees" }), repoConfig: repoConfig() }),
    );
    const removeWorktree = mock(() => Effect.void);
    const service = createService({
      assertPermanentRemovalSupported: () =>
        Effect.fail(
          new HostOperationError({
            operation: "workspace.removeTaskStore",
            message:
              "Cannot remove the task store for workspace ws. Permanent removal is not supported with a configured task store.",
          }),
        ),
      beginWorkspaceRemoval,
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
      removeWorktree,
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("Permanent removal is not supported with a configured task store.");
    expect(beginWorkspaceRemoval).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  test("removeWorkspace releases live sessions before it deletes task data", async () => {
    const events: string[] = [];
    const service = createService({
      activity: activityWith([], (_repoPath) =>
        Effect.sync(() => {
          events.push("release-sessions");
        }),
      ),
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
      removeWorktree: (_repoPath, worktreePath) =>
        Effect.sync(() => {
          events.push(`remove-worktree:${worktreePath}`);
        }),
      removeWorkspaceTaskStore: () =>
        Effect.sync(() => {
          events.push("remove-store");
        }),
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: true,
      }),
    );

    expect(events).toEqual([
      "release-sessions",
      "remove-worktree:/managed/ws/task-1",
      "remove-store",
    ]);
  });

  test("removeWorkspace releases live sessions when it resumes an incomplete removal", async () => {
    const events: string[] = [];
    const service = createService({
      getRepoConfig: () =>
        Effect.succeed(repoConfig({ removal: removalRecord({ phase: "task_store" }) })),
      beginWorkspaceRemoval: () =>
        Effect.succeed({
          record: removalRecord({ phase: "task_store" }),
          repoConfig: repoConfig(),
        }),
      activity: activityWith([], (_repoPath) =>
        Effect.sync(() => {
          events.push("release-sessions");
        }),
      ),
      removeWorkspaceTaskStore: () =>
        Effect.sync(() => {
          events.push("remove-store");
        }),
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: false,
      }),
    );

    expect(events).toEqual(["release-sessions", "remove-store"]);
  });

  test("removeWorkspace removes verified task and historical session worktrees", async () => {
    const removed: Array<{ repoPath: string; worktreePath: string; force: boolean }> = [];
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")], [session("/custom/worktrees/task-1")]),
      listWorktrees: () =>
        Effect.succeed([
          { branch: "odt/task-1", worktreePath: "/managed/ws/task-1" },
          { branch: "odt/task-1", worktreePath: "/custom/worktrees/task-1" },
        ]),
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

  test("removeWorkspace uses the journaled repository config for worktree removal", async () => {
    const removed: string[] = [];
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      getRepoConfig: () => Effect.succeed(repoConfig({ worktreeBasePath: "/old-base" })),
      beginWorkspaceRemoval: () =>
        Effect.succeed({
          record: removalRecord({ phase: "worktrees" }),
          repoConfig: repoConfig({ worktreeBasePath: "/new-base" }),
        }),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/new-base/task-1" }]),
      pathExists: () => Effect.succeed(true),
      removeWorktree: (_repoPath, worktreePath) =>
        Effect.sync(() => {
          removed.push(worktreePath);
        }),
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: true,
      }),
    );

    expect(removed).toEqual(["/new-base/task-1"]);
  });

  test("removeWorkspace resumes a recorded removal and skips removed worktrees", async () => {
    const removed: string[] = [];
    const service = createService({
      getRepoConfig: () =>
        Effect.succeed(
          repoConfig({
            removal: removalRecord({
              phase: "worktrees",
              removedWorktrees: ["/managed/ws/task-1"],
            }),
          }),
        ),
      beginWorkspaceRemoval: () =>
        Effect.succeed({
          record: removalRecord({
            phase: "worktrees",
            removedWorktrees: ["/managed/ws/task-1"],
          }),
          repoConfig: repoConfig(),
        }),
      taskStore: createTaskStoreDouble([taskCard("task-1"), taskCard("task-2")]),
      pathExists: (path) => Effect.succeed(path.startsWith("/managed/")),
      listWorktrees: () =>
        Effect.succeed([
          { branch: "odt/task-1", worktreePath: "/managed/ws/task-1" },
          { branch: "odt/task-2", worktreePath: "/managed/ws/task-2" },
        ]),
      removeWorktree: (_repoPath, worktreePath) =>
        Effect.sync(() => {
          removed.push(worktreePath);
        }),
    });

    const { result } = await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: false,
      }),
    );

    expect(removed).toEqual(["/managed/ws/task-2"]);
    expect(result.removedWorktrees).toEqual(["/managed/ws/task-1", "/managed/ws/task-2"]);
  });

  test("removeWorkspace resumes at the recorded phase without worktree deletion", async () => {
    const removeWorkspaceTaskAssets = mock(() => Effect.void);
    const service = createService({
      getRepoConfig: () =>
        Effect.succeed(repoConfig({ removal: removalRecord({ phase: "attachments" }) })),
      beginWorkspaceRemoval: () =>
        Effect.succeed({
          record: removalRecord({ phase: "attachments" }),
          repoConfig: repoConfig(),
        }),
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      removeWorkspaceTaskAssets,
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: true,
      }),
    );

    expect(removeWorkspaceTaskAssets).toHaveBeenCalled();
  });

  test("matches inventory paths after canonicalization", async () => {
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      canonicalizePath: (path) => Effect.succeed(path.replace("/managed/", "/real/managed/")),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
    });

    const { result } = await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: true,
      }),
    );

    expect(result.removedWorktrees).toEqual(["/real/managed/ws/task-1"]);
  });

  test("removeWorkspace fails before cleanup when a candidate is not a registered worktree", async () => {
    const removeWorkspaceTaskAssets = mock(() => Effect.void);
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")], [session("/custom/worktrees/task-1")]),
      pathExists: (path) => Effect.succeed(path.startsWith("/custom/")),
      listWorktrees: () => Effect.succeed([]),
      removeWorkspaceTaskAssets,
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
    expect(removeWorkspaceTaskAssets).not.toHaveBeenCalled();
  });

  test("removeWorkspace journals an inventory failure", async () => {
    const progress: Array<{ phase: string; lastFailure: string | null }> = [];
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      listWorktrees: () =>
        Effect.fail(
          new HostOperationError({
            operation: "test.listWorktrees",
            message: "git worktree list failed",
          }),
        ),
      recordWorkspaceRemovalProgress: (input) =>
        Effect.sync(() => {
          progress.push({ phase: input.phase, lastFailure: input.lastFailure });
        }),
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("git worktree list failed");
    expect(progress.at(-1)).toEqual({
      phase: "worktrees",
      lastFailure: "git worktree list failed",
    });
  });

  test("removeWorkspace fails on an unclassifiable registered worktree under the managed base", async () => {
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      listWorktrees: () =>
        Effect.succeed([
          { branch: "odt/task-1", worktreePath: "/managed/ws/task-1" },
          { branch: "odt/deleted-task", worktreePath: "/managed/ws/deleted-task" },
        ]),
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("Cannot classify registered worktree(s)");
  });

  test("removeWorkspace keeps the journal and registration when attachment cleanup fails", async () => {
    const removeWorkspaceRegistration = mock(() => Effect.succeed(catalog()));
    const progress: Array<{ phase: string; lastFailure: string | null }> = [];
    const service = createService({
      removeWorkspaceTaskAssets: () =>
        Effect.fail(
          new TaskAssetError({
            operation: "delete",
            code: "purge",
            assetIds: [],
            failedPhase: "remove_workspace_data",
            durableState: "unknown",
            retryAllowed: true,
            message: "disk failure",
          }),
        ),
      recordWorkspaceRemovalProgress: (input) =>
        Effect.sync(() => {
          progress.push({ phase: input.phase, lastFailure: input.lastFailure });
        }),
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
    ).rejects.toThrow("Failed to remove workspace task attachments");
    expect(removeWorkspaceRegistration).not.toHaveBeenCalled();
    expect(progress.at(-1)).toEqual({
      phase: "attachments",
      lastFailure:
        "Failed to remove workspace task attachments: disk failure. Retry removal to continue.",
    });
  });

  test("removeWorkspace drains work starts before purging task assets", async () => {
    const events: string[] = [];
    const service = createService({
      admission: {
        ...createAdmissionDouble(),
        awaitWorkStarts: () =>
          Effect.sync(() => {
            events.push("awaitWorkStarts");
          }),
      },
      beginWorkspaceRemoval: () =>
        Effect.succeed({
          record: removalRecord({ removeTaskWorktrees: false, phase: "task_store" }),
          repoConfig: repoConfig(),
        }),
      removeWorkspaceTaskStore: () =>
        Effect.sync(() => {
          events.push("removeWorkspaceTaskStore");
        }),
      removeWorkspaceTaskAssets: () =>
        Effect.sync(() => {
          events.push("removeWorkspaceTaskAssets");
        }),
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: false,
      }),
    );

    expect(events.lastIndexOf("awaitWorkStarts")).toBeLessThan(
      events.indexOf("removeWorkspaceTaskAssets"),
    );
  });

  test("removeWorkspace reports completed worktrees when a later worktree fails", async () => {
    let removalCount = 0;
    const lastFailure: string[] = [];
    const service = createService({
      taskStore: createTaskStoreDouble(
        [taskCard("task-1"), taskCard("task-2")],
        [session("/custom/worktrees/task-1"), session("/custom/worktrees/task-2")],
      ),
      pathExists: (path) => Effect.succeed(path.startsWith("/custom/")),
      listWorktrees: () =>
        Effect.succeed([
          { branch: "odt/task-1", worktreePath: "/custom/worktrees/task-1" },
          { branch: "odt/task-2", worktreePath: "/custom/worktrees/task-2" },
        ]),
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
      recordWorkspaceRemovalProgress: (input) =>
        Effect.sync(() => {
          if (input.lastFailure !== null) {
            lastFailure.push(input.lastFailure);
          }
        }),
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
    expect(lastFailure[0]).toContain("Removed 1 task worktree(s)");
    expect(lastFailure[0]).toContain("git worktree remove failed");
  });

  test("removeWorkspace journals a pending worktree path before deleting and clears it after success", async () => {
    const progress: Array<{
      pendingWorktreePath: string | null | undefined;
      removedWorktrees: string[];
    }> = [];
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
      recordWorkspaceRemovalProgress: (input) =>
        Effect.sync(() => {
          progress.push({
            pendingWorktreePath: input.pendingWorktreePath,
            removedWorktrees: [...input.removedWorktrees],
          });
        }),
      removeWorktree: () => Effect.void,
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: true,
      }),
    );

    const pendingIndex = progress.findIndex(
      (entry) => entry.pendingWorktreePath === "/managed/ws/task-1",
    );
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(progress[pendingIndex]?.removedWorktrees).toEqual([]);
    const clearedIndex = progress.findIndex((entry) => entry.pendingWorktreePath === null);
    expect(clearedIndex).toBeGreaterThan(pendingIndex);
    expect(progress[clearedIndex]?.removedWorktrees).toEqual(["/managed/ws/task-1"]);
  });

  test("removeWorkspace keeps the pending worktree path when the deletion fails", async () => {
    const progress: Array<{
      pendingWorktreePath: string | null | undefined;
      lastFailure: string | null;
    }> = [];
    const service = createService({
      taskStore: createTaskStoreDouble([taskCard("task-1")]),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
      recordWorkspaceRemovalProgress: (input) =>
        Effect.sync(() => {
          progress.push({
            pendingWorktreePath: input.pendingWorktreePath,
            lastFailure: input.lastFailure,
          });
        }),
      removeWorktree: () =>
        Effect.fail(
          new HostOperationError({
            operation: "test.removeWorktree",
            message: "git worktree remove failed",
          }),
        ),
    });

    await expect(
      Effect.runPromise(
        service.removeWorkspace({
          workspaceId: "ws",
          expectedRepoPath: "/repos/ws",
          removeTaskWorktrees: true,
        }),
      ),
    ).rejects.toThrow("git worktree remove failed");

    expect(progress.at(-2)?.pendingWorktreePath).toBe("/managed/ws/task-1");
    expect(progress.at(-1)?.pendingWorktreePath).toBeUndefined();
    expect(progress.at(-1)?.lastFailure).toContain("git worktree remove failed");
  });

  test("reopens a workspace through settings and clears its admission block", async () => {
    const expected = catalog();
    const reopenWorkspace = mock(() => Effect.succeed(expected));
    const unblockWorkspace = mock(() => {});
    const service = createService({
      admission: { ...createAdmissionDouble(), unblockWorkspace },
      reopenWorkspace,
    });

    await expect(
      Effect.runPromise(
        service.reopenWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
      ),
    ).resolves.toEqual(expected);
    expect(reopenWorkspace).toHaveBeenCalledWith("ws", "/repos/ws");
    expect(unblockWorkspace).toHaveBeenCalledWith("ws");
  });

  test("reserves the workspace before the activity check and releases after close", async () => {
    const calls: string[] = [];
    const service = createService({
      activity: {
        inspect: () => {
          calls.push("inspect");
          return Effect.succeed([]);
        },
        releaseWorkspaceSessions: () => Effect.void,
      },
      admission: {
        ...createAdmissionDouble(),
        reserveWorkspace: () => {
          calls.push("reserve");
          return Effect.void;
        },
        releaseReservation: () => {
          calls.push("release");
        },
        blockWorkspace: () => {
          calls.push("block");
        },
      },
    });

    await Effect.runPromise(
      service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
    );

    expect(calls).toEqual(["reserve", "inspect", "block", "release"]);
  });

  test("releases the reservation when the activity check blocks close", async () => {
    const releaseReservation = mock(() => {});
    const closeWorkspace = mock(() => Effect.succeed(catalog()));
    const service = createService({
      activity: activityWith([{ kind: "terminal", label: "terminal t1 is running a command" }]),
      admission: { ...createAdmissionDouble(), releaseReservation },
      closeWorkspace,
    });

    await expect(
      Effect.runPromise(
        service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
      ),
    ).rejects.toThrow("terminal t1 is running a command");
    expect(releaseReservation).toHaveBeenCalledWith("ws");
    expect(closeWorkspace).not.toHaveBeenCalled();
  });

  test("releases the reservation after a committed removal", async () => {
    const releaseReservation = mock(() => {});
    const service = createService({
      admission: { ...createAdmissionDouble(), releaseReservation },
    });

    await Effect.runPromise(
      service.removeWorkspace({
        workspaceId: "ws",
        expectedRepoPath: "/repos/ws",
        removeTaskWorktrees: false,
      }),
    );

    expect(releaseReservation).toHaveBeenCalledWith("ws");
  });

  test("rejects close when another operation holds the workspace reservation", async () => {
    const closeWorkspace = mock(() => Effect.succeed(catalog()));
    const service = createService({
      admission: {
        ...createAdmissionDouble(),
        reserveWorkspace: () =>
          Effect.fail(
            new HostValidationError({
              message: "A workspace remove operation is already in progress for ws.",
              field: "workspaceId",
            }),
          ),
      },
      closeWorkspace,
    });

    await expect(
      Effect.runPromise(
        service.closeWorkspace({ workspaceId: "ws", expectedRepoPath: "/repos/ws" }),
      ),
    ).rejects.toThrow("already in progress for ws");
    expect(closeWorkspace).not.toHaveBeenCalled();
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
