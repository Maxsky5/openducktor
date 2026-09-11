import type { RepoGitConfig, SettingsSnapshot } from "@openducktor/contracts";

type RepositoryProviderConfigSnapshot = {
  repoPath: string;
  git: RepoGitConfig;
};

export type SettingsSnapshotChanges = {
  workspacesChanged: boolean;
  agentRuntimesChanged: boolean;
  kanbanDoneVisibleDaysChanged: boolean;
  changedGitProviderRepoPaths: string[];
};

const isSameJsonValue = <Value>(left: Value, right: Value): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const changedGitProviderRepoPaths = (
  previous: Record<string, RepositoryProviderConfigSnapshot> | undefined,
  next: Record<string, RepositoryProviderConfigSnapshot>,
): string[] => {
  if (previous === undefined) {
    return Object.values(next).map((workspace) => workspace.repoPath);
  }

  const repoPaths: string[] = [];
  for (const [workspaceId, nextWorkspace] of Object.entries(next)) {
    const previousWorkspace = previous[workspaceId];
    if (
      previousWorkspace === undefined ||
      previousWorkspace.repoPath !== nextWorkspace.repoPath ||
      !isSameJsonValue(previousWorkspace.git, nextWorkspace.git)
    ) {
      repoPaths.push(nextWorkspace.repoPath);
    }
  }
  return repoPaths;
};

export const diffSettingsSnapshots = (
  previous: SettingsSnapshot | undefined,
  next: SettingsSnapshot,
): SettingsSnapshotChanges => ({
  workspacesChanged:
    previous === undefined || !isSameJsonValue(previous.workspaces, next.workspaces),
  agentRuntimesChanged:
    previous === undefined || !isSameJsonValue(previous.agentRuntimes, next.agentRuntimes),
  kanbanDoneVisibleDaysChanged:
    previous !== undefined && previous.kanban.doneVisibleDays !== next.kanban.doneVisibleDays,
  changedGitProviderRepoPaths: changedGitProviderRepoPaths(previous?.workspaces, next.workspaces),
});
