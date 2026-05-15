import {
  type GitConflictOperation,
  type GitDiffScope,
  type GlobalConfig,
  globalConfigSchema,
  type RepoConfig,
} from "@openducktor/contracts";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";

export type CreateGitServiceInput = {
  gitPort: GitPort;
  settingsConfig?: SettingsConfigPort;
  worktreeFiles?: WorktreeFilePort;
};

export type GitScopeInput = {
  repoPath: string;
  workingDir?: string;
};

export type GitAheadBehindInput = GitScopeInput & {
  targetBranch: string;
};

export type GitSwitchBranchInput = {
  branch: string;
  create: boolean;
  repoPath: string;
};

export type GitCreateWorktreeInput = {
  branch: string;
  createBranch: boolean;
  repoPath: string;
  worktreePath: string;
};

export type GitRemoveWorktreeInput = {
  force: boolean;
  repoPath: string;
  worktreePath: string;
};

export type GitCommitAllInput = GitScopeInput & {
  message: string;
};

export type GitPushBranchInput = GitScopeInput & {
  branch: string;
  forceWithLease?: boolean;
  remote: string;
  setUpstream?: boolean;
};

export type GitRebaseBranchInput = GitScopeInput & {
  targetBranch: string;
};

export type GitAbortConflictInput = GitScopeInput & {
  operation: GitConflictOperation;
};

export type GitDiffInput = GitScopeInput & {
  targetBranch?: string;
};

export type GitWorktreeStatusInput = GitScopeInput & {
  diffScope: GitDiffScope;
  targetBranch: string;
};

export const resolveGitWorkingDirectory = async (
  gitPort: GitPort,
  repoPath: string,
  workingDir: string | undefined,
): Promise<string> => {
  const canonicalRepoPath = await gitPort.canonicalizePath(repoPath).catch((error: unknown) => {
    throw new Error(`repo_path does not exist or is not accessible: ${repoPath}`, {
      cause: error,
    });
  });

  if (!(await gitPort.isGitRepository(canonicalRepoPath))) {
    throw new Error(`Not a git repository: ${canonicalRepoPath}`);
  }

  if (!workingDir || workingDir === repoPath) {
    return canonicalRepoPath;
  }

  const canonicalWorkingDir = await gitPort.canonicalizePath(workingDir).catch((error: unknown) => {
    throw new Error(`working_dir does not exist or is not accessible: ${workingDir}`, {
      cause: error,
    });
  });

  if (canonicalWorkingDir === canonicalRepoPath) {
    return canonicalWorkingDir;
  }

  if (!(await gitPort.isGitRepository(canonicalWorkingDir))) {
    throw new Error(`Not a git repository: ${canonicalWorkingDir}`);
  }

  if (!(await gitPort.shareGitCommonDirectory(canonicalRepoPath, canonicalWorkingDir))) {
    throw new Error(
      `working_dir is not within authorized repository or linked worktrees: ${workingDir}`,
    );
  }

  return canonicalWorkingDir;
};

export const parseGlobalConfig = (payload: unknown): GlobalConfig => {
  if (payload === null) {
    throw new Error("No OpenDucktor workspace config is available for git worktree mutation.");
  }

  return globalConfigSchema.parse(payload);
};

export const findRepoConfigByPath = async (
  settingsConfig: SettingsConfigPort,
  canonicalRepoPath: string,
): Promise<RepoConfig> => {
  const config = parseGlobalConfig(await settingsConfig.readConfig());
  for (const repoConfig of Object.values(config.workspaces)) {
    const configuredRepoPath = await settingsConfig.canonicalizePath(repoConfig.repoPath);
    if (configuredRepoPath === canonicalRepoPath) {
      return repoConfig;
    }
  }

  throw new Error(`Repository is not registered in OpenDucktor settings: ${canonicalRepoPath}`);
};

export const isDefinitiveNonWorktreeGitError = (error: unknown): boolean => {
  const errorText = String(error instanceof Error ? error.message : error).toLowerCase();
  return [
    "not a git repository",
    "not a git worktree",
    "not a working tree",
    "is not a working tree",
  ].some((needle) => errorText.includes(needle));
};

export const requireSettingsConfig = (
  settingsConfig: SettingsConfigPort | undefined,
): SettingsConfigPort => {
  if (!settingsConfig) {
    throw new Error("Settings config port is required for git worktree mutation commands.");
  }

  return settingsConfig;
};

export const requireWorktreeFiles = (
  worktreeFiles: WorktreeFilePort | undefined,
): WorktreeFilePort => {
  if (!worktreeFiles) {
    throw new Error("Worktree file port is required for git worktree mutation commands.");
  }

  return worktreeFiles;
};

export const cleanupFailedCreatedWorktree = async (
  gitPort: GitPort,
  repoPath: string,
  worktreePath: string,
  branch: string,
  deleteBranch: boolean,
): Promise<string> => {
  const cleanupErrors: string[] = [];

  await gitPort.removeWorktree(repoPath, worktreePath, true).catch((error: unknown) => {
    cleanupErrors.push(`Also failed to remove worktree: ${String(error)}`);
  });
  if (deleteBranch) {
    await gitPort.deleteLocalBranch(repoPath, branch, true).catch((error: unknown) => {
      cleanupErrors.push(`Also failed to delete created branch ${branch}: ${String(error)}`);
    });
  }

  return cleanupErrors.length > 0 ? `\n${cleanupErrors.join("\n")}` : "";
};

export const normalizeCreateGitServiceInput = (
  input: GitPort | CreateGitServiceInput,
): CreateGitServiceInput =>
  "gitPort" in input
    ? input
    : {
        gitPort: input,
      };
