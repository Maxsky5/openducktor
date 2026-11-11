import { withSettingsConfigMutationTestMethods } from "../../../test-support/settings-config-mutations";
import { createDefaultGlobalConfig } from "../../../config/global-config";
import { createWorkspaceSettingsServiceTestDouble } from "../../../test-support/service-test-doubles";
import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import { createTaskWorktreeService as createEffectTaskWorktreeService } from "./task-worktree-service";

const createTaskWorktreeService = (...args: Parameters<typeof createEffectTaskWorktreeService>) =>
  createEffectTaskWorktreeService(...args);
const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { beforeWorktreeRemoval: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  promptAppends: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
  ...overrides,
});
const createWorkspaceSettingsService = (config: RepoConfig): WorkspaceSettingsService =>
  createWorkspaceSettingsServiceTestDouble({
    getRepoConfig(workspaceId: string) {
      if (workspaceId !== "repo") {
        return Effect.fail(
          new HostOperationError({
            operation: "test.getRepoConfigByRepoPath",
            message: `Workspace is not configured for repository: ${String(workspaceId)}`,
            details: { workspaceId },
          }),
        );
      }
      return Effect.succeed(config);
    },
  });
const createSettingsConfig = ({
  existingPaths = new Set<string>(),
  canonicalPaths = {},
}: {
  existingPaths?: Set<string>;
  canonicalPaths?: Record<string, string>;
} = {}): SettingsConfigPort =>
  withSettingsConfigMutationTestMethods({
    defaultWorktreeBasePath(workspaceId) {
      return `/home/dev/.openducktor/worktrees/${workspaceId}`;
    },
    defaultRepoWorktreeBasePath(repoPath) {
      return `/home/dev/.openducktor/worktrees/${repoPath.split("/").at(-1) ?? "repo"}`;
    },
    resolveConfiguredPath(rawPath) {
      return rawPath === "~/worktrees" ? "/home/dev/worktrees" : rawPath;
    },
    readConfig() {
      return Effect.succeed(createDefaultGlobalConfig());
    },
    updateConfig() {
      return Effect.die("Unexpected settings config write.");
    },
    canonicalizePath(path) {
      return Effect.succeed(canonicalPaths[path] ?? (path === "/repo" ? "/canonical/repo" : path));
    },
    pathExists(path) {
      return Effect.succeed(existingPaths.has(path));
    },
    join(...paths) {
      return paths.join("/").replaceAll(/\/+/g, "/");
    },
  }) satisfies SettingsConfigPort;
describe("createTaskWorktreeService", () => {
  test("returns a deterministic task worktree when the directory exists", async () => {
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig({
        existingPaths: new Set(["/home/dev/worktrees/task-1"]),
      }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({ worktreeBasePath: "~/worktrees" }),
      ),
    });
    await expect(
      Effect.runPromise(
        service.getTaskWorktree({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({
      workingDirectory: "/home/dev/worktrees/task-1",
    });
  });
  test("preserves the configured worktree path used by sessions and cleanup", async () => {
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig({
        existingPaths: new Set(["/home/dev/worktrees/task-1"]),
        canonicalPaths: { "/home/dev/worktrees/task-1": "/canonical/worktrees/task-1" },
      }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({ worktreeBasePath: "~/worktrees" }),
      ),
    });
    await expect(
      Effect.runPromise(
        service.getTaskWorktree({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({ workingDirectory: "/home/dev/worktrees/task-1" });
  });
  test("returns null when the deterministic task worktree is absent", async () => {
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig(),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.getTaskWorktree({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toBeNull();
  });
  test("rejects worktree paths that canonicalize to the repository root", async () => {
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig({
        existingPaths: new Set(["/home/dev/.openducktor/worktrees/repo/task-1"]),
        canonicalPaths: {
          "/home/dev/.openducktor/worktrees/repo/task-1": "/canonical/repo",
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.getTaskWorktree({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(
      "The worktree path of task task-1 is the repository root. Change the worktree base path in the repository settings.",
    );
  });

  test("rejects a saved workspace reference after its repository path changes", async () => {
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig({
        existingPaths: new Set(["/home/dev/worktrees/task-1"]),
      }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({ repoPath: "/moved/repo", worktreeBasePath: "~/worktrees" }),
      ),
    });
    await expect(
      Effect.runPromise(
        service.getTaskWorktree({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("workspace no longer matches this repository");
  });

  test("rejects task IDs that can name another directory", async () => {
    const taskIds = ["../other", "nested/child", "nested\\child", "C:other", ".", ".."];
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig({
        existingPaths: new Set(taskIds.map((taskId) => `/home/dev/worktrees/${taskId}`)),
      }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({ worktreeBasePath: "~/worktrees" }),
      ),
    });

    for (const taskId of taskIds) {
      await expect(
        Effect.runPromise(
          service.getTaskWorktree({ workspaceId: "repo", repoPath: "/repo", taskId }),
        ),
      ).rejects.toThrow("Task ID must name one worktree directory");
    }
  });
});
