import { buildSessionBootstrapSchema } from "@openducktor/contracts";
import { buildBranchName, validateTransition } from "../../../domain/task";
import {
  effectiveTargetBranchForTask,
  resolveBuildStartPoint,
  resolveRuntimeDescriptorForBuild,
  rollbackFailedBuildWorktree,
} from "../support/builder-worktree-cleanup";
import { requireBuildStartDependencies } from "../support/required-task-dependencies";
import { runHookCommandsAllowFailure } from "../support/workflow-hooks";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskBuildStartUseCase = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
}: CreateTaskServiceInput): Pick<TaskService, "buildStart"> => ({
  async buildStart(input) {
    const { repoPath, taskId, runtimeKind } = input;
    const dependencies = requireBuildStartDependencies(
      gitPort,
      runtimeDefinitionsService,
      runtimeRegistry,
      settingsConfig,
      systemCommands,
      worktreeFiles,
      workspaceSettingsService,
    );
    const descriptor = resolveRuntimeDescriptorForBuild(
      dependencies.runtimeDefinitionsService,
      runtimeKind,
    );
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const canonicalRepoPath = await dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
    if (!(await dependencies.gitPort.isGitRepository(canonicalRepoPath))) {
      throw new Error(`Not a git repository: ${canonicalRepoPath}`);
    }

    const task = await taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
    validateTransition(task, [task], task.status, "in_progress");

    const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
    const targetBranch = await effectiveTargetBranchForTask(
      dependencies.workspaceSettingsService,
      task,
      canonicalRepoPath,
    );
    const worktreeBase = repoConfig.worktreeBasePath
      ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
      : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
    const worktreePath = dependencies.settingsConfig.join(worktreeBase, taskId);

    if (await dependencies.settingsConfig.pathExists(worktreePath)) {
      throw new Error(`Worktree path already exists for task ${taskId}: ${worktreePath}`);
    }
    await dependencies.worktreeFiles.ensureDirectory(worktreeBase);

    const startPoint = await resolveBuildStartPoint(
      dependencies,
      canonicalRepoPath,
      targetBranch,
      task.targetBranch === undefined,
    );
    await dependencies.gitPort.createWorktree(
      canonicalRepoPath,
      worktreePath,
      branch,
      true,
      startPoint.reference,
    );

    let createdTrackingRef: string | null = null;
    try {
      if (startPoint.upstreamRemote) {
        const upstreamSetup = await dependencies.gitPort.configureBranchUpstream(
          canonicalRepoPath,
          worktreePath,
          branch,
          startPoint.upstreamRemote,
        );
        createdTrackingRef = upstreamSetup.createdTrackingRef;
      }

      await dependencies.worktreeFiles.copyConfiguredPaths(
        canonicalRepoPath,
        worktreePath,
        repoConfig.worktreeCopyPaths,
      );

      const preStartHooks = repoConfig.hooks.preStart.map((hook) => hook.trim()).filter(Boolean);
      const failure = await runHookCommandsAllowFailure(
        dependencies.systemCommands,
        preStartHooks,
        worktreePath,
      );
      if (failure) {
        throw new Error(`Worktree setup script command failed: ${failure.hook}\n${failure.stderr}`);
      }
    } catch (error) {
      const cleanupError = await rollbackFailedBuildWorktree(
        dependencies,
        canonicalRepoPath,
        worktreePath,
        branch,
        createdTrackingRef,
      );
      if (error instanceof Error) {
        throw new Error(`${error.message}${cleanupError}`, { cause: error });
      }
      throw new Error(`${String(error)}${cleanupError}`);
    }

    const runtime = await dependencies.runtimeRegistry
      .ensureWorkspaceRuntime({
        runtimeKind,
        repoPath: canonicalRepoPath,
        workingDirectory: canonicalRepoPath,
        descriptor,
      })
      .catch((error: unknown) => {
        throw new Error(`${runtimeKind} build runtime failed to start for task ${taskId}`, {
          cause: error,
        });
      });

    await taskStore.transitionTask({ repoPath: canonicalRepoPath, taskId, status: "in_progress" });

    return buildSessionBootstrapSchema.parse({
      runtimeKind,
      runtimeId: runtime.runtimeId,
      workingDirectory: worktreePath,
    });
  },
});
