import { describe, expect, test } from "bun:test";
import { repoConfigSchema, type RepoConfig, type WorkspaceCatalog } from "@openducktor/contracts";
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

const catalog = (): WorkspaceCatalog => ({
  openWorkspaces: [],
  closedWorkspaces: [],
  incompleteRemovals: [],
  onboardingCompleted: true,
});

const createDependencies = ({
  canonicalizePath,
  listWorktrees,
  pathExists,
  settingsCanonicalizePath = (path) => Effect.succeed(path),
}: {
  canonicalizePath: (path: string) => Effect.Effect<string, HostOperationErrorAggregate>;
  listWorktrees: GitPort["listWorktrees"];
  pathExists: (path: string) => Effect.Effect<boolean, never>;
  settingsCanonicalizePath?: (path: string) => Effect.Effect<string, HostOperationErrorAggregate>;
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
    listTasks: () => Effect.succeed([]),
    listAgentSessionsForTasks: () => Effect.succeed([]),
  } satisfies Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">,
  workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
    getWorkspaceCatalog: () => Effect.succeed(catalog()),
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
});
