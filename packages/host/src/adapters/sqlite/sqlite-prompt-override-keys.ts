import { parsePromptOverrideKey, type PromptOverrideTarget } from "@openducktor/contracts";
import { and, eq, or, type SQL } from "drizzle-orm";
import type {
  globalPromptOverrides,
  workspacePromptOverrides,
} from "./sqlite-host-settings-schema";

/** The owner and prompt columns of a settings key. The settings schema accepts only valid keys. */
export const promptOverrideColumns = (key: string): PromptOverrideTarget => {
  const target = parsePromptOverrideKey(key);
  if (!target) throw new Error(`Prompt override key "${key}" is invalid. Fix the prompt settings.`);
  return target;
};

type PromptOverrideOwnerColumns = Pick<
  typeof globalPromptOverrides | typeof workspacePromptOverrides,
  "ownerKind" | "ownerId" | "promptId"
>;

/** Matches the rows of the given settings keys. */
export const promptOverrideKeysMatch = (
  table: PromptOverrideOwnerColumns,
  keys: readonly string[],
): SQL | undefined =>
  or(
    ...keys.map((key) => {
      const { ownerKind, ownerId, promptId } = promptOverrideColumns(key);
      return and(
        eq(table.ownerKind, ownerKind),
        eq(table.ownerId, ownerId),
        eq(table.promptId, promptId),
      );
    }),
  );
