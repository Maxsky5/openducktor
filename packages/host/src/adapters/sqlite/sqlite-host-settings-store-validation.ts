import { type GlobalConfig, type JsonValue, jsonValuesEqual } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostValidationError,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";

export const settingsWriteOperation = "hostSettings.write";

export type HostSettingsChanges = {
  changed: boolean;
  /** True when a workspace was added, removed, or moved to another repository path. */
  membershipChanged: boolean;
};

/** Writes one settings group. Without current settings, the group is new. */
export type HostSettingsWriter = (
  session: HostDatabaseSession,
  current: GlobalConfig | null,
  next: GlobalConfig,
) => Effect.Effect<HostSettingsChanges, HostOperationErrorAggregate | HostValidationErrorAggregate>;

export const settingsGroupChanged = (changed: boolean): HostSettingsChanges => ({
  changed,
  membershipChanged: false,
});

// Settings have at most 9 columns per row; 100 rows stay below the conservative 999-bind limit.
const SETTINGS_ROWS_PER_BATCH = 100;
export function* settingsRowBatches<Row>(rows: Row[]): Generator<Row[]> {
  for (let index = 0; index < rows.length; index += SETTINGS_ROWS_PER_BATCH)
    yield rows.slice(index, index + SETTINGS_ROWS_PER_BATCH);
}

export const validateHostSettings = <A>(read: () => A, context: string) =>
  Effect.try({
    try: read,
    catch: (cause) =>
      new HostValidationError({
        message: `Invalid host database settings for ${context}. Restore a valid database or correct this record: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });

export const settingsKeyChanges = <Value extends JsonValue>(
  current: Partial<Record<string, Value>> | undefined,
  next: Partial<Record<string, Value>>,
) => {
  const changed: [string, Value][] = [];
  for (const [key, value] of Object.entries(next))
    if (value !== undefined && !jsonValuesEqual(current?.[key], value)) changed.push([key, value]);
  const removed = Object.entries(current ?? {}).flatMap(([key, value]) =>
    value !== undefined && (!Object.hasOwn(next, key) || next[key] === undefined) ? [key] : [],
  );
  return { changed, removed };
};
