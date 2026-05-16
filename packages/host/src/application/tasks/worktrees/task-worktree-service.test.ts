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
  repoPath: "/canonical/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});
const createWorkspaceSettingsService = (config: RepoConfig): WorkspaceSettingsService =>
  ({
    getRepoConfigByRepoPath(repoPath: unknown) {
      if (repoPath !== "/repo") {
        return Effect.fail(
          new HostOperationError({
            operation: "test.getRepoConfigByRepoPath",
            message: `Workspace is not configured for repository: ${String(repoPath)}`,
            details: { repoPath },
          }),
        );
      }
      return Effect.succeed(config);
    },
  }) as Pick<
    WorkspaceSettingsService,
    "getRepoConfigByRepoPath"
  > as unknown as WorkspaceSettingsService;
const createSettingsConfig = ({
  existingPaths = new Set<string>(),
  canonicalPaths = {},
}: {
  existingPaths?: Set<string>;
  canonicalPaths?: Record<string, string>;
} = {}): SettingsConfigPort =>
  ({
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
      return Effect.succeed(null);
    },
    writeConfig() {
      return Effect.succeed(undefined);
    },
    canonicalizePath(path) {
      return Effect.succeed(canonicalPaths[path] ?? path);
    },
    pathExists(path) {
      return Effect.succeed(existingPaths.has(path));
    },
    join(...paths) {
      return paths.join("/").replaceAll(/\/+/g, "/");
    },
  }) as SettingsConfigPort as SettingsConfigPort;
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
        service.getTaskWorktree({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toEqual({
      workingDirectory: "/home/dev/worktrees/task-1",
    });
  });
  test("returns null when the deterministic task worktree is absent", async () => {
    const service = createTaskWorktreeService({
      settingsConfig: createSettingsConfig(),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.getTaskWorktree({
          repoPath: "/repo",
          taskId: "task-1",
        }),
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
        service.getTaskWorktree({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).rejects.toThrow(
      "Builder continuation cannot start until a builder worktree exists for task task-1. The resolved worktree points to the repository root.",
    );
  });
});
