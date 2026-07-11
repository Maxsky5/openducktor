import type { SettingsModalOpenTarget } from "@/components/features/settings/settings-modal-navigation";

export const buildDevServerSettingsOpenTarget = (
  repositoryPath: string | null,
): SettingsModalOpenTarget => ({
  repositoryPath,
  repositorySection: "scripts",
  anchor: "dev-servers",
});
