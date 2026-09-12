import { describe, expect, test } from "bun:test";
import {
  type IncompleteWorkspaceRemoval,
  repoConfigSchema,
  type RepoConfig,
  taskCardSchema,
  type TaskCard,
  type WorkspaceCatalog,
  type WorkspaceRecord,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { collectWorkspaceTaskWorktreePaths } from "./workspace-worktree-inventory";

const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig =>
  repoConfigSchema.parse({
    workspaceId: "ws",
    workspaceName: "Workspace",
    repoPath: "/repos/ws",
    defaultRuntimeKind: "opencode",
    agentStudioState: { openTaskIds: [] },
    ...overrides,
  });

const task = (id: string): TaskCard =>
  taskCardSchema.parse({
    id,
    title: id,
    status: "open",
    issueType: "task",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

const catalog = (): WorkspaceCatalog => ({
  openWorkspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
  onboardingCompleted: true,
});

const workspaceRecord = (overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord =>
  workspaceRecordSchema.parse({
    workspaceId: "other",
    workspaceName: "Other",
    repoPath: "/repos/other",
    isActive: false,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: null,
    effectiveWorktreeBasePath: null,
    ...overrides,
  });

const incompleteRemoval = (workspace: WorkspaceRecord): IncompleteWorkspaceRemoval => ({
  workspace,
  record: {
    version: 1,
    operationId: "removal-1",
    removeTaskWorktrees: true,
    phase: "worktrees",
    removedWorktrees: [],
    pendingWorktreePath: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    lastFailure: null,
  },
});

const createDependencies = ({
  canonicalizePath,
  listWorktrees,
  pathExists,
  settingsCanonicalizePath = (path) => Effect.succeed(path),
  listTasks = () => Effect.succeed([]),
  workspaceCatalog = catalog(),
}: {
  canonicalizePath: (path: string) => Effect.Effect<string, HostOperationErrorAggregate>;
  listWorktrees: GitPort["listWorktrees"];
  pathExists: (path: string) => Effect.Effect<boolean, never>;
  settingsCanonicalizePath?: (path: string) => Effect.Effect<string, HostOperationErrorAggregate>;
  listTasks?: (input: { repoPath: string }) => Effect.Effect<TaskCard[], never>;
  workspaceCatalog?: WorkspaceCatalog;
}) => ({
  gitPort: createGitPortTestDouble({
    canonicalizePath,
    isRegisteredWorktree: () => Effect.succeed(true),
    listWorktrees,
    removeWorktree: () => Effect.void,
  }),
  settingsConfig: createSettingsConfigTestDouble({
    canonicalizePath: settingsCanonicalizePath,
    defaultWorktreeBasePath: (workspaceId) => `/managed/${workspaceId}`,
    join: (...paths) => paths.join("/").replaceAll(/\/+/g, "/"),
    pathExists,
    readConfig: () => Effect.succeed(null),
    resolveConfiguredPath: (path) => path,
  }),
  taskStore: {
    listTasks,
    listAgentSessionsForTasks: () => Effect.succeed([]),
  } satisfies Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">,
  workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
    getWorkspaceCatalog: () => Effect.succeed(workspaceCatalog),
  }),
});

describe("workspace worktree inventory", () => {
  test("propagates a canonicalization failure for a worktree path that exists", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) =>
        path === "/managed/ws/task-1"
          ? Effect.fail(
              new HostOperationError({
                operation: "git.canonicalizePath",
                message: "Failed to canonicalize /managed/ws/task-1.",
              }),
            )
          : Effect.succeed(path),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
      pathExists: () => Effect.succeed(true),
    });

    const error = await Effect.runPromise(
      Effect.flip(collectWorkspaceTaskWorktreePaths(dependencies, repoConfig())),
    );

    expect(error.message).toContain("Failed to canonicalize /managed/ws/task-1.");
  });

  test("uses the lexical path when a listed worktree no longer exists", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) =>
        path === "/managed/ws/task-1"
          ? Effect.fail(
              new HostOperationError({
                operation: "git.canonicalizePath",
                message: "Failed to canonicalize /managed/ws/task-1.",
              }),
            )
          : Effect.succeed(path),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/task-1", worktreePath: "/managed/ws/task-1" }]),
      pathExists: () => Effect.succeed(false),
    });

    const paths = await Effect.runPromise(
      collectWorkspaceTaskWorktreePaths(dependencies, repoConfig()),
    );

    expect(paths).toEqual([]);
  });

  test("classifies an orphan worktree under a symlinked managed base", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) => Effect.succeed(path),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/orphan", worktreePath: "/real-base/orphan-1" }]),
      pathExists: (path) => Effect.succeed(path === "/real-base/orphan-1"),
      settingsCanonicalizePath: (path) =>
        Effect.succeed(path === "/link-base" ? "/real-base" : path),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        collectWorkspaceTaskWorktreePaths(
          dependencies,
          repoConfig({ worktreeBasePath: "/link-base" }),
        ),
      ),
    );

    expect(error.message).toContain("Cannot classify registered worktree(s) under");
  });

  test("propagates a canonicalization failure for a managed base that exists", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) => Effect.succeed(path),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/orphan", worktreePath: "/base/orphan-1" }]),
      pathExists: (path) => Effect.succeed(path === "/base"),
      settingsCanonicalizePath: (path) =>
        path === "/base"
          ? Effect.fail(
              new HostOperationError({
                operation: "settingsConfig.canonicalizePath",
                message: "Failed to canonicalize /base.",
              }),
            )
          : Effect.succeed(path),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        collectWorkspaceTaskWorktreePaths(dependencies, repoConfig({ worktreeBasePath: "/base" })),
      ),
    );

    expect(error.message).toContain("Failed to canonicalize /base.");
  });

  test("uses the lexical base when the managed base no longer exists", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) => Effect.succeed(path),
      listWorktrees: () =>
        Effect.succeed([{ branch: "odt/orphan", worktreePath: "/base/orphan-1" }]),
      pathExists: () => Effect.succeed(false),
      settingsCanonicalizePath: (path) =>
        path === "/base"
          ? Effect.fail(
              new HostOperationError({
                operation: "settingsConfig.canonicalizePath",
                message: "Failed to canonicalize /base.",
              }),
            )
          : Effect.succeed(path),
    });

    const paths = await Effect.runPromise(
      collectWorkspaceTaskWorktreePaths(dependencies, repoConfig({ worktreeBasePath: "/base" })),
    );

    expect(paths).toEqual([]);
  });

  test("rejects a candidate claimed by another workspace on the shared base", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) => Effect.succeed(path),
      listWorktrees: () => Effect.succeed([{ branch: "odt/task-1", worktreePath: "/base/task-1" }]),
      pathExists: () => Effect.succeed(true),
      listTasks: () => Effect.succeed([task("task-1")]),
      workspaceCatalog: {
        ...catalog(),
        openWorkspaces: [
          workspaceRecordSchema.parse({
            workspaceId: "other",
            workspaceName: "Other",
            repoPath: "/repos/other",
            isActive: false,
            hasConfig: true,
            configuredWorktreeBasePath: "/base",
            defaultWorktreeBasePath: "/base",
            effectiveWorktreeBasePath: "/base",
          }),
        ],
      },
    });

    const error = await Effect.runPromise(
      Effect.flip(
        collectWorkspaceTaskWorktreePaths(dependencies, repoConfig({ worktreeBasePath: "/base" })),
      ),
    );

    expect(error.message).toContain("another workspace also claims it");
    expect(error.message).toContain("/base/task-1");
  });

  test("rejects a candidate claimed through an aliased workspace base", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) =>
        Effect.succeed(path === "/link-base/task-1" ? "/base/task-1" : path),
      listWorktrees: () => Effect.succeed([{ branch: "odt/task-1", worktreePath: "/base/task-1" }]),
      pathExists: () => Effect.succeed(true),
      listTasks: () => Effect.succeed([task("task-1")]),
      settingsCanonicalizePath: (path) => Effect.succeed(path === "/link-base" ? "/base" : path),
      workspaceCatalog: {
        ...catalog(),
        openWorkspaces: [
          workspaceRecord({
            effectiveWorktreeBasePath: "/link-base",
            repoPath: "/repos/other",
          }),
        ],
      },
    });

    const error = await Effect.runPromise(
      Effect.flip(
        collectWorkspaceTaskWorktreePaths(dependencies, repoConfig({ worktreeBasePath: "/base" })),
      ),
    );

    expect(error.message).toContain("another workspace also claims it");
  });

  test("rejects removal when another workspace on the shared base has an incomplete removal", async () => {
    const listedRepos: string[] = [];
    const dependencies = createDependencies({
      canonicalizePath: (path) => Effect.succeed(path),
      listWorktrees: () => Effect.succeed([]),
      pathExists: () => Effect.succeed(true),
      listTasks: (input) => {
        listedRepos.push(input.repoPath);
        return Effect.succeed([]);
      },
      workspaceCatalog: {
        ...catalog(),
        incompleteRemovals: [
          incompleteRemoval(workspaceRecord({ effectiveWorktreeBasePath: "/base" })),
        ],
      },
    });

    const error = await Effect.runPromise(
      Effect.flip(
        collectWorkspaceTaskWorktreePaths(dependencies, repoConfig({ worktreeBasePath: "/base" })),
      ),
    );

    expect(error.message).toContain("incomplete removal on the same worktree base");
    expect(listedRepos).toEqual(["/repos/ws"]);
  });

  test("keeps the repository path of a workspace with an incomplete removal", async () => {
    const dependencies = createDependencies({
      canonicalizePath: (path) => Effect.succeed(path),
      listWorktrees: () =>
        Effect.succeed([{ branch: "(detached)", worktreePath: "/base/other-repo" }]),
      pathExists: () => Effect.succeed(true),
      listTasks: () => Effect.succeed([]),
      workspaceCatalog: {
        ...catalog(),
        incompleteRemovals: [incompleteRemoval(workspaceRecord({ repoPath: "/base/other-repo" }))],
      },
    });

    const paths = await Effect.runPromise(
      collectWorkspaceTaskWorktreePaths(dependencies, repoConfig({ worktreeBasePath: "/base" })),
    );

    expect(paths).toEqual([]);
  });
});
