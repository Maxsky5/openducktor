// The fictional workspace of the product views: the Fieldnotes note app of the user sam.

export const WORKSPACE = "fieldnotes";

/** The folder of the repository on the computer of the user. */
export const REPOSITORY_PATH = `/Users/sam/code/${WORKSPACE}`;

/** The OpenDucktor folder in the home folder of the user. */
export const CONFIG_PATH = "/Users/sam/.openducktor";

/**
 * The tiles of the workspace rail: the initials of the open workspaces. Fieldnotes is the first
 * and selected one. The second one can have a running session, which its tile marks.
 */
export const RAIL_TILES = ["FI", "FA", "DS"] as const;

/** A task id of the workspace, as the product builds it from the first ten letters of its name. */
export function taskId(suffix: string): string {
  return `${WORKSPACE.slice(0, 10)}-${suffix}`;
}
