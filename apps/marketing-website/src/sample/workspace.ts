// The fictional workspaces of the product views. Fieldnotes, the note app of the user sam, is the
// selected workspace of every view.

export const WORKSPACE = "fieldnotes";

/** The folder of the repository on the computer of the user. */
export const REPOSITORY_PATH = `/Users/sam/code/${WORKSPACE}`;

/** The OpenDucktor folder in the home folder of the user. */
export const CONFIG_PATH = "/Users/sam/.openducktor";

/**
 * The open workspaces in the order of the workspace rail. Each tile shows the initials of its
 * name, as workspace-tile-appearance.ts derives them. Fieldnotes is the first and selected one.
 */
export const WORKSPACES = [
  { name: WORKSPACE, tile: "FI" },
  { name: "fable-api", tile: "FA" },
  { name: "design-system", tile: "DS" },
] as const;

export type WorkspaceName = (typeof WORKSPACES)[number]["name"];

/** A task id of the workspace, as the product builds it from the first ten letters of its name. */
export function taskId(suffix: string, workspace: string = WORKSPACE): string {
  return `${workspace.slice(0, 10)}-${suffix}`;
}
