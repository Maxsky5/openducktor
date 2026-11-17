import type { RepoConfig } from "@openducktor/contracts";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export function* managedWorktreeRoots(
  settings: Pick<
    SettingsConfigPort,
    "defaultRepoWorktreeBasePath" | "defaultWorktreeBasePath" | "resolveConfiguredPath"
  >,
  workspace: Pick<RepoConfig, "workspaceId" | "worktreeBasePath">,
  canonicalRepoPath: string,
): Iterable<string> {
  yield workspace.worktreeBasePath === undefined
    ? settings.defaultWorktreeBasePath(workspace.workspaceId)
    : settings.resolveConfiguredPath(workspace.worktreeBasePath);
  yield settings.defaultRepoWorktreeBasePath(canonicalRepoPath);
}
