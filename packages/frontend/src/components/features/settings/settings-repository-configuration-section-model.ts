import type { RepoConfig } from "@openducktor/contracts";

export function resolveFolderPickerInitialPath(
  selectedRepoConfig: RepoConfig,
  selectedRepoEffectiveWorktreeBasePath: string | null,
): string | undefined {
  const configuredPath = selectedRepoConfig.worktreeBasePath?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  return selectedRepoEffectiveWorktreeBasePath ?? undefined;
}
