import { Effect } from "effect";
import type { DevServerService } from "../application/dev-servers/dev-server-service";
import type { WorkspaceSettingsService } from "../application/workspaces/workspace-settings-service";
import type { GitPort } from "../ports/git-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";

const unexpectedEffectCall = (service: string, method: string) => () =>
  Effect.dieMessage(`Unexpected ${service} call: ${method}`);

const unexpectedSyncCall = (service: string, method: string): never => {
  throw new Error(`Unexpected ${service} call: ${method}`);
};

export const createDevServerServiceTestDouble = <Overrides extends Partial<DevServerService>>(
  overrides: Overrides,
): DevServerService => ({
  getState: unexpectedEffectCall("dev server service", "getState"),
  restart: unexpectedEffectCall("dev server service", "restart"),
  start: unexpectedEffectCall("dev server service", "start"),
  stop: unexpectedEffectCall("dev server service", "stop"),
  ...overrides,
});

export const createGitPortTestDouble = <Overrides extends Partial<GitPort>>(
  overrides: Overrides,
): GitPort => ({
  abortConflict: unexpectedEffectCall("Git port", "abortConflict"),
  canonicalizePath: unexpectedEffectCall("Git port", "canonicalizePath"),
  commitAll: unexpectedEffectCall("Git port", "commitAll"),
  commitsAheadBehind: unexpectedEffectCall("Git port", "commitsAheadBehind"),
  configureBranchUpstream: unexpectedEffectCall("Git port", "configureBranchUpstream"),
  createWorktree: unexpectedEffectCall("Git port", "createWorktree"),
  deleteLocalBranch: unexpectedEffectCall("Git port", "deleteLocalBranch"),
  deleteReference: unexpectedEffectCall("Git port", "deleteReference"),
  fetchRemote: unexpectedEffectCall("Git port", "fetchRemote"),
  getCurrentBranch: unexpectedEffectCall("Git port", "getCurrentBranch"),
  getDiff: unexpectedEffectCall("Git port", "getDiff"),
  getRepositoryRoot: unexpectedEffectCall("Git port", "getRepositoryRoot"),
  getStatus: unexpectedEffectCall("Git port", "getStatus"),
  getWorktreeStatusData: unexpectedEffectCall("Git port", "getWorktreeStatusData"),
  getWorktreeStatusSummaryData: unexpectedEffectCall("Git port", "getWorktreeStatusSummaryData"),
  isAncestor: unexpectedEffectCall("Git port", "isAncestor"),
  isGitRepository: unexpectedEffectCall("Git port", "isGitRepository"),
  isRegisteredWorktree: unexpectedEffectCall("Git port", "isRegisteredWorktree"),
  listBranches: unexpectedEffectCall("Git port", "listBranches"),
  listChangedFiles: unexpectedEffectCall("Git port", "listChangedFiles"),
  listFiles: unexpectedEffectCall("Git port", "listFiles"),
  listRemotes: unexpectedEffectCall("Git port", "listRemotes"),
  mergeBranch: unexpectedEffectCall("Git port", "mergeBranch"),
  pullBranch: unexpectedEffectCall("Git port", "pullBranch"),
  pushBranch: unexpectedEffectCall("Git port", "pushBranch"),
  rebaseAbort: unexpectedEffectCall("Git port", "rebaseAbort"),
  rebaseBranch: unexpectedEffectCall("Git port", "rebaseBranch"),
  referenceExists: unexpectedEffectCall("Git port", "referenceExists"),
  removeWorktree: unexpectedEffectCall("Git port", "removeWorktree"),
  resetWorktreeSelection: unexpectedEffectCall("Git port", "resetWorktreeSelection"),
  restoreWorktreeToReference: unexpectedEffectCall("Git port", "restoreWorktreeToReference"),
  shareGitCommonDirectory: unexpectedEffectCall("Git port", "shareGitCommonDirectory"),
  suggestedSquashCommitMessage: unexpectedEffectCall("Git port", "suggestedSquashCommitMessage"),
  switchBranch: unexpectedEffectCall("Git port", "switchBranch"),
  ...overrides,
});

export const createSettingsConfigTestDouble = <Overrides extends Partial<SettingsConfigPort>>(
  overrides: Overrides,
): SettingsConfigPort => ({
  canonicalizePath: unexpectedEffectCall("settings config", "canonicalizePath"),
  defaultRepoWorktreeBasePath: () =>
    unexpectedSyncCall("settings config", "defaultRepoWorktreeBasePath"),
  defaultWorktreeBasePath: () => unexpectedSyncCall("settings config", "defaultWorktreeBasePath"),
  join: () => unexpectedSyncCall("settings config", "join"),
  pathExists: unexpectedEffectCall("settings config", "pathExists"),
  readConfig: unexpectedEffectCall("settings config", "readConfig"),
  resolveConfiguredPath: () => unexpectedSyncCall("settings config", "resolveConfiguredPath"),
  writeConfig: unexpectedEffectCall("settings config", "writeConfig"),
  ...overrides,
});

export const createWorkspaceSettingsServiceTestDouble = <
  Overrides extends Partial<WorkspaceSettingsService>,
>(
  overrides: Overrides,
): WorkspaceSettingsService => ({
  addWorkspace: unexpectedEffectCall("workspace settings service", "addWorkspace"),
  getRepoConfig: unexpectedEffectCall("workspace settings service", "getRepoConfig"),
  getRepoConfigByRepoPath: unexpectedEffectCall(
    "workspace settings service",
    "getRepoConfigByRepoPath",
  ),
  getSettingsSnapshot: unexpectedEffectCall("workspace settings service", "getSettingsSnapshot"),
  listWorkspaces: unexpectedEffectCall("workspace settings service", "listWorkspaces"),
  reorderWorkspaces: unexpectedEffectCall("workspace settings service", "reorderWorkspaces"),
  saveRepoSettings: unexpectedEffectCall("workspace settings service", "saveRepoSettings"),
  saveSettingsSnapshot: unexpectedEffectCall("workspace settings service", "saveSettingsSnapshot"),
  selectWorkspace: unexpectedEffectCall("workspace settings service", "selectWorkspace"),
  setTheme: unexpectedEffectCall("workspace settings service", "setTheme"),
  updateAgentModelFavorites: unexpectedEffectCall(
    "workspace settings service",
    "updateAgentModelFavorites",
  ),
  updateGlobalGitConfig: unexpectedEffectCall(
    "workspace settings service",
    "updateGlobalGitConfig",
  ),
  updateRepoConfig: unexpectedEffectCall("workspace settings service", "updateRepoConfig"),
  updateRepoHooks: unexpectedEffectCall("workspace settings service", "updateRepoHooks"),
  ...overrides,
});

export const createWorktreeFilePortTestDouble = <Overrides extends Partial<WorktreeFilePort>>(
  overrides: Overrides,
): WorktreeFilePort => ({
  copyConfiguredPaths: unexpectedEffectCall("worktree file port", "copyConfiguredPaths"),
  ensureDirectory: unexpectedEffectCall("worktree file port", "ensureDirectory"),
  pathIsWithinRoot: unexpectedEffectCall("worktree file port", "pathIsWithinRoot"),
  removePathIfPresent: unexpectedEffectCall("worktree file port", "removePathIfPresent"),
  resolvePathWithinRoot: unexpectedEffectCall("worktree file port", "resolvePathWithinRoot"),
  resolveWorktreePath: () => unexpectedSyncCall("worktree file port", "resolveWorktreePath"),
  ...overrides,
});
