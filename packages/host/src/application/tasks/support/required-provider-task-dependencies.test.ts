import { describe, expect, test } from "bun:test";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import type { GitProviderResolver } from "../../git/git-provider-resolver";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskTerminalCleanupPort } from "../task-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { requireApprovalContextDependencies } from "./required-provider-task-dependencies";
import {
  requireDirectMergeDependencies,
  requireLinkMergedPullRequestDependencies,
} from "./required-task-dependencies";

const dependencyStub = <Dependency>(): Dependency => {
  // SAFETY: These gates only check that each value exists, then return it unchanged.
  return {} as Dependency;
};

describe("provider-neutral task dependency gates", () => {
  test("approval context requires only Git and provider-neutral services", () => {
    const gitPort = dependencyStub<GitPort>();
    const gitProviderResolver = dependencyStub<GitProviderResolver>();
    const settingsConfig = dependencyStub<SettingsConfigPort>();
    const taskWorktreeService = dependencyStub<TaskWorktreeService>();
    const workspaceSettingsService = dependencyStub<WorkspaceSettingsService>();

    expect(
      requireApprovalContextDependencies({
        gitPort,
        gitProviderResolver,
        settingsConfig,
        taskWorktreeService,
        workspaceSettingsService,
      }),
    ).toEqual({
      gitPort,
      gitProviderResolver,
      settingsConfig,
      taskWorktreeService,
      workspaceSettingsService,
    });
  });

  test("direct merge does not require a Git provider", () => {
    const devServerService = dependencyStub<DevServerService>();
    const gitPort = dependencyStub<GitPort>();
    const settingsConfig = dependencyStub<SettingsConfigPort>();
    const taskWorktreeService = dependencyStub<TaskWorktreeService>();
    const terminalService = dependencyStub<TaskTerminalCleanupPort>();
    const worktreeFiles =
      dependencyStub<
        NonNullable<Parameters<typeof requireDirectMergeDependencies>[0]["worktreeFiles"]>
      >();
    const workspaceSettingsService = dependencyStub<WorkspaceSettingsService>();

    expect(
      requireDirectMergeDependencies({
        devServerService,
        gitPort,
        settingsConfig,
        taskWorktreeService,
        terminalService,
        worktreeFiles,
        workspaceSettingsService,
      }),
    ).toEqual({
      devServerService,
      gitPort,
      settingsConfig,
      taskWorktreeService,
      terminalService,
      worktreeFiles,
      workspaceSettingsService,
    });
  });

  test("merged Pull Request cleanup does not require a Git provider", () => {
    const devServerService = dependencyStub<DevServerService>();
    const gitPort = dependencyStub<GitPort>();
    const settingsConfig = dependencyStub<SettingsConfigPort>();
    const taskWorktreeService = dependencyStub<TaskWorktreeService>();
    const terminalService = dependencyStub<TaskTerminalCleanupPort>();
    const worktreeFiles =
      dependencyStub<
        NonNullable<Parameters<typeof requireLinkMergedPullRequestDependencies>[0]["worktreeFiles"]>
      >();
    const workspaceSettingsService = dependencyStub<WorkspaceSettingsService>();

    expect(
      requireLinkMergedPullRequestDependencies({
        devServerService,
        gitPort,
        settingsConfig,
        taskWorktreeService,
        terminalService,
        worktreeFiles,
        workspaceSettingsService,
      }),
    ).toEqual({
      devServerService,
      gitPort,
      settingsConfig,
      taskWorktreeService,
      terminalService,
      worktreeFiles,
      workspaceSettingsService,
    });
  });
});
