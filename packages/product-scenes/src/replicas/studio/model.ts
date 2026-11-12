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
/**
 * The panels that the views show, by the tab kinds of panel-tab-kinds.ts. The `document` kind is the
 * Artifacts tab. The Files tab stays in the strip, and no view opens it.
 */
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

export type ArtifactLabels = {
  title: string;
  /** The status line of task-artifacts.tsx while the artifact is absent. */
  empty: string;
  /** Only a document has the edit button. A review has none. */
  editable: boolean;
  /** The verdict badge of a saved review. */
  verdict?: string;
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

/**
 * The state of a check row in task-execution-ci-check-card.tsx: a passing, a failing, or a pending
 * check. The product shows more states, such as Skipped and Warning, that no scene shows.
 */
export type CheckState = "success" | "failure" | "pending";

const CHECK_STATES: readonly CheckState[] = ["success", "failure", "pending"];

/** The state of a check row, from its `data-state`. */
export function checkState(value: string | undefined): CheckState {
  const state = CHECK_STATES.find((each) => each === value);
  if (!state) throw new Error(`A check row has the unknown state "${value}".`);
  return state;
}

/** The status of all checks, as the summary badge of task-execution-ci-checks-list.tsx shows it. */
export type ChecksStatus = "passing" | "failing" | "pending";

/** The rows that a check shows when you open it: its workflow, its details, and its times. */
export type CheckInfo = { workflow: string; details: string; started: string; completed: string };

export type CiCheck = { name: string; state: CheckState; info?: CheckInfo };

/** A failing check wins over a pending check, and a pending check wins over a passing check. */
export function checksStatus(states: readonly CheckState[]): ChecksStatus {
  if (states.includes("failure")) return "failing";
  if (states.includes("pending")) return "pending";
  return "passing";
}

/** The summary of checksSummaryLabel in task-execution-ci-presentation.ts, such as 1 failing. */
export function checksSummary(states: readonly CheckState[]): string {
  const status = checksStatus(states);
  const state = ({ failing: "failure", pending: "pending", passing: "success" } as const)[status];
  return `${states.filter((each) => each === state).length} ${status}`;
}
