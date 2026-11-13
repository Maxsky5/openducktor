import type {
  AgentChatTranscriptRow,
  AgentChatUserMessageAnchor,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  countFailedCalls,
  type EarlierCalls,
  groupToolRuns,
  readEarlierCalls,
  type ToolRun,
  type ToolRunClassifier,
  type ToolRunSegment,
  type ToolRunSummary,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";

// The tool runs of the desktop transcript. Each run is one row of the row window: its first row,
// which shows the whole run. A call, a fold, or a page of earlier calls then changes only the
// height of that row, as a streamed message does, so the row window does not change its rows.

/** What the reader chose for a run. A run without a choice opens or folds by its default. */
export type ToolRunFoldChoice = "open" | "folded";

/** The folds that the reader chose, and the long runs where the reader showed earlier calls. */
export type ToolRunFolds = {
  /** The choice of each run, by the key of the first row of the run. */
  choices: ReadonlyMap<string, ToolRunFoldChoice>;
  /**
   * The earlier calls that stay hidden in each long run where the reader showed some, by the key
   * of the first row of the run.
   */
  keptHidden: ReadonlyMap<string, number>;
};

/** The rows of the row window, where each tool run gives only its first row. */
export type ToolRunWindowRows = {
  rows: AgentChatTranscriptRow[];
  /** Each run by the key of its first row. */
  runs: ReadonlyMap<string, ToolRun>;
  /** The runs whose calls all ended and that another row follows. */
  settledRunKeys: ReadonlySet<string>;
  /**
   * The window index of the first row and the hidden row count of each run of two or more calls,
   * as `index:count` pairs. It changes only when that layout changes, so readers can memoize on it,
   * and it gives the hidden rows to `foldUserMessageAnchors`.
   */
  layoutKey: string;
};

const NO_RUNS: ReadonlyMap<string, ToolRun> = new Map();
const NO_RUN_KEYS: ReadonlySet<string> = new Set();

/** Gives the row window the first row of each tool run in place of all the calls of the run. */
export const buildToolRunWindowRows = (
  rows: AgentChatTranscriptRow[],
  segments: readonly ToolRunSegment[],
): ToolRunWindowRows => {
  const shown: AgentChatTranscriptRow[] = [];
  const runs = new Map<string, ToolRun>();
  const settledRunKeys = new Set<string>();
  const layout: string[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind === "row") {
      shown.push(segment.row);
      return;
    }
    const { run } = segment;
    const [first] = run.rows;
    if (!first) return;
    runs.set(run.runKey, run);
    if (run.summary.activeCount === 0 && index < segments.length - 1) {
      settledRunKeys.add(run.runKey);
    }
    if (run.rows.length > 1) layout.push(`${shown.length}:${run.rows.length - 1}`);
    shown.push(first);
  });
  if (runs.size === 0) {
    return { rows, runs: NO_RUNS, settledRunKeys: NO_RUN_KEYS, layoutKey: "" };
  }
  // Runs of one call hide no row, so the window shows the rows of the transcript.
  return layout.length === 0
    ? { rows, runs, settledRunKeys, layoutKey: "" }
    : { rows: shown, runs, settledRunKeys, layoutKey: layout.join(",") };
};

// The last folded anchors of each list of anchors. A new call changes the layout of its run, but
// rarely moves a user message, so the readers of the anchors keep them and read no layout again.
const lastFoldedAnchors = new WeakMap<AgentChatUserMessageAnchor[], AgentChatUserMessageAnchor[]>();

/** Moves the user message anchors to their rows in a window where tool runs hide their calls. */
export const foldUserMessageAnchors = (
  anchors: AgentChatUserMessageAnchor[],
  layoutKey: string,
): AgentChatUserMessageAnchor[] => {
  if (layoutKey === "") return anchors;
  const folded = foldAnchorRows(anchors, layoutKey);
  const previous = lastFoldedAnchors.get(anchors);
  if (previous?.every((anchor, index) => anchor.rowIndex === folded[index]?.rowIndex)) {
    return previous;
  }
  lastFoldedAnchors.set(anchors, folded);
  return folded;
};

const foldAnchorRows = (
  anchors: AgentChatUserMessageAnchor[],
  layoutKey: string,
): AgentChatUserMessageAnchor[] => {
  const folds = layoutKey.split(",").map((pair) => pair.split(":").map(Number));
  return anchors.map((anchor) => {
    let hiddenBefore = 0;
    for (const [shownIndex = 0, hiddenCount = 0] of folds) {
      // A user message never sits in a run, so a run that starts after the anchor hides no row
      // before it, and nor does any later run.
      if (shownIndex + hiddenBefore >= anchor.rowIndex) break;
      hiddenBefore += hiddenCount;
    }
    return { ...anchor, rowIndex: anchor.rowIndex - hiddenBefore };
  });
};

/** A tool run in a turn, with the folds that the reader chose. */
export type ToolRunItem = {
  kind: "tool_run";
  key: string;
  /** The key of the first row of the run. */
  runKey: string;
  run: ToolRun;
  folded: boolean;
  /** The failed calls among the earlier calls that the run hides. */
  earlierFailedCount: number;
} & EarlierCalls &
  ToolRunSummary;

export type AgentChatTurnItem =
  | { kind: "row"; key: string; row: AgentChatTranscriptRow }
  | ToolRunItem;

const NO_EARLIER_CALLS: EarlierCalls = { earlierCallCount: 0, shownEarlierCount: 0 };

const NO_FOLDS: ToolRunFolds = { choices: new Map(), keptHidden: new Map() };

// A run keeps its item while the run and its folds do not change, so its group compares it at once.
const knownItems = new WeakMap<ToolRun, ToolRunItem>();

const readToolRunItem = (
  run: ToolRun,
  folds: ToolRunFolds,
  foldsByDefault: boolean,
): ToolRunItem => {
  const choice = folds.choices.get(run.runKey);
  const folded = choice === undefined ? foldsByDefault : choice === "folded";
  const earlier = folded
    ? NO_EARLIER_CALLS
    : readEarlierCalls(run.rows.length, folds.keptHidden.get(run.runKey));
  const previous = knownItems.get(run);
  if (
    previous &&
    previous.folded === folded &&
    previous.earlierCallCount === earlier.earlierCallCount &&
    previous.shownEarlierCount === earlier.shownEarlierCount
  ) {
    return previous;
  }
  const item: ToolRunItem = {
    kind: "tool_run",
    key: `${run.runKey}:tool-run`,
    runKey: run.runKey,
    run,
    folded,
    ...earlier,
    earlierFailedCount: countFailedCalls(run.rows.slice(0, earlier.earlierCallCount)),
    ...run.summary,
  };
  knownItems.set(run, item);
  return item;
};

/**
 * The rows of a turn in the row window, with each tool run as one item. With
 * `collapseFinishedRuns`, a run whose calls all ended and that another row follows folds, unless
 * the reader opened it.
 */
export const buildTurnItems = (
  rows: readonly AgentChatTranscriptRow[],
  windowRows: ToolRunWindowRows,
  folds: ToolRunFolds,
  collapseFinishedRuns: boolean,
): AgentChatTurnItem[] =>
  rows.map((row) => {
    const run = windowRows.runs.get(row.key);
    if (!run) return { kind: "row", key: row.key, row };
    const foldsByDefault = collapseFinishedRuns && windowRows.settledRunKeys.has(run.runKey);
    return readToolRunItem(run, folds, foldsByDefault);
  });

/** The items of rows that show without a row window, as in the tour. */
export const buildToolRunItems = (
  rows: readonly AgentChatTranscriptRow[],
  classify: ToolRunClassifier,
): AgentChatTurnItem[] => {
  const windowRows = buildToolRunWindowRows([...rows], groupToolRuns(rows, classify));
  return buildTurnItems(windowRows.rows, windowRows, NO_FOLDS, false);
};
