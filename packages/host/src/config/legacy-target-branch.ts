import { z, type JSONType } from "zod";

/** Saved targets before branch names became required read a missing branch as `main`. */
const LEGACY_TARGET_BRANCH_NAME = "main";
/** Saved workspace settings without a default target branch used `origin/main`. */
export const LEGACY_DEFAULT_TARGET_BRANCH = { remote: "origin", branch: LEGACY_TARGET_BRANCH_NAME };

const savedTargetSchema = z.record(z.string(), z.json());

/**
 * Reads a target branch that an earlier version saved, as that version read it. A new target
 * always names its branch, so only the import of saved data may call this.
 */
export const readLegacyTargetBranch = (value: JSONType): JSONType => {
  const target = savedTargetSchema.safeParse(value);
  return target.success && target.data.branch === undefined
    ? { ...target.data, branch: LEGACY_TARGET_BRANCH_NAME }
    : value;
};
