import {
  parsePromptOverrideKey,
  type JsonValue,
  type PromptOverrideTarget,
} from "@openducktor/contracts";
import { and, eq, or, type SQL } from "drizzle-orm";
import type { SqliteRemoteResult } from "drizzle-orm/sqlite-proxy";
import { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SqliteDrizzleExecutor } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { HostDatabaseSession, hostDatabaseSchema } from "./sqlite-host-database-schema";
import { settingsKeyChanges, settingsRowBatches } from "./sqlite-host-settings-store-validation";
import type {
  globalPromptAppends,
  globalPromptOverrides,
  workspacePromptAppends,
  workspacePromptOverrides,
} from "./sqlite-host-settings-schema";

/** The owner and prompt columns of a settings key. The settings schema accepts only valid keys. */
export const promptKeyColumns = (key: string): PromptOverrideTarget => {
  const target = parsePromptOverrideKey(key);
  if (!target) throw new Error(`Prompt key "${key}" is invalid. Fix the prompt settings.`);
  return target;
};

type PromptKeyColumns = Pick<
  | typeof globalPromptOverrides
  | typeof workspacePromptOverrides
  | typeof globalPromptAppends
  | typeof workspacePromptAppends,
  "ownerKind" | "ownerId" | "promptId"
>;

/** Matches the rows of the given settings keys. */
export const promptKeysMatch = (
  table: PromptKeyColumns,
  keys: readonly string[],
): SQL | undefined =>
  or(
    ...keys.map((key) => {
      const { ownerKind, ownerId, promptId } = promptKeyColumns(key);
      return and(
        eq(table.ownerKind, ownerKind),
        eq(table.ownerId, ownerId),
        eq(table.promptId, promptId),
      );
    }),
  );

/** A delete or an upsert of prompt rows. */
type PromptRowsWrite = (
  database: SqliteDrizzleExecutor<typeof hostDatabaseSchema>,
) => PromiseLike<SqliteRemoteResult>;

/**
 * Writes the changed keys of one keyed prompt layer, such as the global overrides: it deletes the
 * removed keys and upserts the changed keys, in row batches. Returns whether a key changed.
 */
export const writePromptLayerRows = <Value extends JsonValue, Row>(
  session: HostDatabaseSession,
  operation: string,
  current: Partial<Record<string, Value>> | undefined,
  next: Partial<Record<string, Value>>,
  table: {
    remove: (keys: string[]) => PromptRowsWrite;
    row: (key: string, value: Value) => Row;
    upsert: (rows: Row[]) => PromptRowsWrite;
  },
): Effect.Effect<boolean, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const { changed, removed } = settingsKeyChanges(current, next);
    for (const keys of settingsRowBatches(removed))
      yield* session.execute(table.remove(keys), operation);
    for (const rows of settingsRowBatches(changed.map(([key, value]) => table.row(key, value))))
      yield* session.execute(table.upsert(rows), operation);
    return changed.length > 0 || removed.length > 0;
  });
