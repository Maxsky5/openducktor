import type { SettingsRepoConfig } from "@openducktor/contracts";

export function resolveFolderPickerInitialPath(
  selectedRepoConfig: SettingsRepoConfig,
  selectedRepoEffectiveWorktreeBasePath: string | null,
): string | undefined {
  const configuredPath = selectedRepoConfig.worktreeBasePath?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  return selectedRepoEffectiveWorktreeBasePath ?? undefined;
}
