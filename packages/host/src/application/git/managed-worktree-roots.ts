import type { RepoConfig } from "@openducktor/contracts";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export const managedWorktreeBaseForRepoConfig = (
  settings: Pick<SettingsConfigPort, "defaultWorktreeBasePath" | "resolveConfiguredPath">,
  repoConfig: Pick<RepoConfig, "workspaceId" | "worktreeBasePath">,
): string =>
  repoConfig.worktreeBasePath !== undefined
    ? settings.resolveConfiguredPath(repoConfig.worktreeBasePath)
    : settings.defaultWorktreeBasePath(repoConfig.workspaceId);

export function* managedWorktreeRoots(
  settings: Pick<
    SettingsConfigPort,
    "defaultRepoWorktreeBasePath" | "defaultWorktreeBasePath" | "resolveConfiguredPath"
  >,
  workspace: Pick<RepoConfig, "workspaceId" | "worktreeBasePath">,
  canonicalRepoPath: string,
): Iterable<string> {
  yield managedWorktreeBaseForRepoConfig(settings, workspace);
  yield settings.defaultRepoWorktreeBasePath(canonicalRepoPath);
}
