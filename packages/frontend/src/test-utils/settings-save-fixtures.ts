import type { SettingsSaveOutcome } from "@/types/state-slices";

/** A settings save that wrote the snapshot, changed no runtime, and reloaded its caches. */
export const savedSettingsResult = (): SettingsSaveOutcome => ({
  type: "saved",
  workspaces: [],
  runtimeApplications: [],
  refreshError: null,
});
