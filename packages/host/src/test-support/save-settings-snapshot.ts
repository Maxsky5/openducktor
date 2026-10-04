import type { SettingsSnapshotSaveInput } from "@openducktor/contracts";
import type { WorkspaceSettingsService } from "../application/workspaces/workspace-settings-model";

/** Saves a settings snapshot without the runtime lifecycle, for tests of the settings store. */
export const saveSettingsSnapshot = (
  service: Pick<WorkspaceSettingsService, "saveSettingsSnapshotWith">,
  snapshot: SettingsSnapshotSaveInput,
) => service.saveSettingsSnapshotWith(snapshot, (_prepared, write) => write);
