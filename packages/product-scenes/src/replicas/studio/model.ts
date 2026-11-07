// The data of the session window replica: the tones of the workflow rail, the panels, the changed
// files of the Diffs tab, and the window state of a frame.
import type { Session } from "../../sample/sessions";
import type { NavEntry } from "../shell/nav";
import type { RoleId } from "../vocabulary";

type StepTone =
  | "available"
  | "optional"
  | "blocked"
  | "in_progress"
  | "done"
  | "waiting_input"
  | "rejected";
/** One tone for each role of the rail, in rail order. */
export type RailTones = readonly [StepTone, StepTone, StepTone, StepTone];
/** The panels that the views show. The Files tab stays in the strip, and no view opens it. */
export type PanelId = "document" | "diffs" | "ci_checks";
export type Focus = "chat" | "panel";
export type GitFile = {
  path: string;
  type: "added" | "modified";
  add: number;
  del: number;
  open?: boolean;
  comments?: number;
};

export type DocumentLabels = {
  title: string;
  empty: string;
  updated: string;
};

/**
 * The session window in a frame: the tones of the workflow rail and its selected role, the quick
 * action, the session in the composer, the right panel, and the sessions of the sidebar.
 */
export type StudioFrame = {
  tones: RailTones;
  selected: RoleId;
  action: string;
  actionDisabled: boolean;
  session: Session;
  panel: PanelId;
  /** The CI Checks tab shows only with a linked pull request. */
  checksTab: boolean;
  focus: Focus;
  /** The review step gives the diff more room. */
  panelSize?: "wide";
  nav: readonly NavEntry[];
};

/** The Git panel lists files in path order, as git diff does. */
export function byPath(files: readonly GitFile[]): GitFile[] {
  return files.toSorted((left, right) => (left.path < right.path ? -1 : 1));
}
