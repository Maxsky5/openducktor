import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  deriveWorkspaceInitials,
  tileForegroundColor,
} from "@openducktor/frontend-core/workspaces/workspace-tile-appearance";

export type WorkspaceTileSource = Pick<
  WorkspaceRecord,
  "workspaceName" | "abbreviation" | "tileColor" | "iconDataUrl"
>;

export type WorkspaceTileFace = {
  /** The abbreviation, or initials from the name when the workspace has none. */
  label: string;
  /** The picked tile color with a label color picked by contrast. Null uses theme colors. */
  colors: { background: string; foreground: string } | null;
  iconDataUrl: string | null;
};

/** The same workspace face as the desktop rail: image, or abbreviation on the picked color. */
export const workspaceTileFace = (workspace: WorkspaceTileSource): WorkspaceTileFace => ({
  label: workspace.abbreviation ?? deriveWorkspaceInitials(workspace.workspaceName),
  colors: workspace.tileColor
    ? { background: workspace.tileColor, foreground: tileForegroundColor(workspace.tileColor) }
    : null,
  iconDataUrl: workspace.iconDataUrl ?? null,
});
