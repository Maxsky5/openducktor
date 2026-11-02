import {
  diffSettingsSnapshot,
  settingsSnapshotSchema,
  settingsSnapshotSaveInputSchema,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../effect/host-errors";
import type { WorkspaceSettingsService } from "../application/workspaces/workspace-settings-model";

/** Saves a settings snapshot without the runtime lifecycle, for tests of the settings store. */
export const saveSettingsSnapshot = (
  service: Pick<
    WorkspaceSettingsService,
    "getSettingsSnapshot" | "prepareSettingsSnapshot" | "saveSettingsSnapshotWith"
  >,
  snapshot: SettingsSnapshotSaveInput | Partial<SettingsSnapshot>,
) =>
  Effect.gen(function* () {
    const current = yield* service.getSettingsSnapshot();
    const edits = yield* Effect.try({
      try: () =>
        "chat" in snapshot || "agentRuntimes" in snapshot || "system" in snapshot
          ? diffSettingsSnapshot(current, settingsSnapshotSchema.parse({ ...current, ...snapshot }))
          : settingsSnapshotSaveInputSchema.parse(snapshot),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const prepared = yield* service.prepareSettingsSnapshot(edits);
    const result = yield* service.saveSettingsSnapshotWith(prepared, (write) => write);
    return result.workspaces;
  });
