import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import { findRepoConfigByPath, isDefinitiveNonWorktreeGitError } from "./git-service-inputs";

export type RemoveWorktreeAndFilesystemPathInput = {
  force: boolean;
  managedWorktreeBasePath?: string;
  repoPath: string;
  worktreePath: string;
};

export type RemoveWorktreeAndFilesystemPathDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  worktreeFiles: WorktreeFilePort;
};

const managedWorktreeBasePath = async (
  settingsConfig: SettingsConfigPort,
  canonicalRepoPath: string,
): Promise<string> => {
  const repoConfig = await findRepoConfigByPath(settingsConfig, canonicalRepoPath);
  return repoConfig.worktreeBasePath !== undefined
    ? settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
    : settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
};

const assertForcedCleanupAllowed = async (
  { settingsConfig, worktreeFiles }: RemoveWorktreeAndFilesystemPathDependencies,
  input: Pick<RemoveWorktreeAndFilesystemPathInput, "managedWorktreeBasePath" | "repoPath">,
  effectiveWorktreePath: string,
  cause: unknown,
): Promise<void> => {
  const managedBase =
    input.managedWorktreeBasePath ??
    (await managedWorktreeBasePath(settingsConfig, input.repoPath));
  const allowed =
    (await worktreeFiles.pathIsWithinRoot(input.repoPath, effectiveWorktreePath)) ||
    (await worktreeFiles.pathIsWithinRoot(managedBase, effectiveWorktreePath));
  if (!allowed) {
    throw new Error(
      `Refusing forced worktree cleanup outside managed roots for ${effectiveWorktreePath}`,
      { cause },
    );
  }
};

export const removeWorktreeAndFilesystemPath = async (
  dependencies: RemoveWorktreeAndFilesystemPathDependencies,
  input: RemoveWorktreeAndFilesystemPathInput,
): Promise<void> => {
  const { gitPort, worktreeFiles } = dependencies;
  const { repoPath, worktreePath, force } = input;
  const effectiveWorktreePath = worktreeFiles.resolveWorktreePath(repoPath, worktreePath);

  if (await worktreeFiles.pathIsWithinRoot(effectiveWorktreePath, repoPath)) {
    throw new Error("worktree path cannot be the repository root");
  }

  try {
    await gitPort.removeWorktree(repoPath, worktreePath, force);
  } catch (error) {
    if (!force || !isDefinitiveNonWorktreeGitError(error)) {
      throw error;
    }

    await assertForcedCleanupAllowed(dependencies, input, effectiveWorktreePath, error);
  }

  await worktreeFiles.removePathIfPresent(effectiveWorktreePath).catch((error: unknown) => {
    throw new Error(
      `git worktree removal left filesystem path cleanup incomplete for ${worktreePath}`,
      { cause: error },
    );
  });
};
