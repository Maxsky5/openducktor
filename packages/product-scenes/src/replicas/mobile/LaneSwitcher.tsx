// The lane switcher of the phone board, as board-lane-switcher.tsx and board-lane.tsx in
// apps/mobile/src/features/tasks/board: a rail with one cell for each lane, where the task count
// sits over the accent bar and the short label of the lane. Each cell is at least 96 points wide,
// so the labels keep their size and the rail scrolls. The selection pill and the lane titles under
// the rail follow the pager. The title row ends with the Filters button. board-pager.ts moves the
// pill and the titles with `--lane-progress` and scrolls the rail.
import { Funnel } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { flag } from "../flag";
import { laneCountLabel } from "../format";
import { LANE_TITLES, type LaneId } from "../vocabulary";
import "./LaneSwitcher.css";

/** The tones of the workflow states, as `tone` in the Spec, Plan, Build workflow. */
export type LaneTone =
  | "neutral"
  | "pending"
  | "info"
  | "warning"
  | "destructive"
  | "review"
  | "approval"
  | "success";

export type PhoneLane = { id: LaneId; title: string; shortLabel: string; tone: LaneTone };

/**
 * The lanes of the built-in workflow, in board order: the title of the lane header, the short
 * label of the rail (the state label when the state has no short label), and the tone.
 */
export const PHONE_LANES = [
  { id: "open", title: LANE_TITLES.open, shortLabel: "Backlog", tone: "neutral" },
  { id: "spec_ready", title: LANE_TITLES.spec_ready, shortLabel: "Spec ready", tone: "pending" },
  {
    id: "ready_for_dev",
    title: LANE_TITLES.ready_for_dev,
    shortLabel: "Ready for dev",
    tone: "info",
  },
  { id: "in_progress", title: LANE_TITLES.in_progress, shortLabel: "In progress", tone: "warning" },
  { id: "blocked", title: LANE_TITLES.blocked, shortLabel: "Blocked", tone: "destructive" },
  { id: "ai_review", title: LANE_TITLES.ai_review, shortLabel: "AI review", tone: "review" },
  {
    id: "human_review",
    title: LANE_TITLES.human_review,
    shortLabel: "Human review",
    tone: "approval",
  },
  { id: "closed", title: LANE_TITLES.closed, shortLabel: "Done", tone: "success" },
] as const satisfies readonly PhoneLane[];

/** The narrowest lane cell of board-lane-switcher.tsx, in points. */
const CELL_MIN_WIDTH = 96;
/** The inset of the cells in the rail, so the pill has room for its shadow. */
const RAIL_INSET = 8;

/** The width of the phone display, in dp. */
const VIEWPORT = 411;

/**
 * The scroll of the rail that centers the cell of lane `index`, as the effect of
 * board-lane-switcher.tsx sets it after a lane change, without an animation.
 */
export function railScroll(index: number): number {
  return Math.max(0, RAIL_INSET + (index + 0.5) * CELL_MIN_WIDTH - VIEWPORT / 2);
}

type LaneSwitcherProps = {
  /** The number of tasks in each lane. */
  counts: Readonly<Record<LaneId, number>>;
  /** The index of the lane that the board shows. */
  selected: number;
};

export function LaneSwitcher({ counts, selected }: LaneSwitcherProps): ReactElement {
  const progress: CSSProperties & { "--lane-progress": number; "--rail-scroll": number } = {
    "--lane-progress": selected,
    "--rail-scroll": railScroll(selected),
  };
  return (
    <div className="mob-lanes" style={progress} data-lanes="">
      <div className="mob-lane-scroll">
        <div className="mob-lane-rail" data-lane-rail="">
          <i className="mob-lane-pill" data-tone={PHONE_LANES[selected]?.tone} data-lane-pill="" />
          {PHONE_LANES.map((lane, index) => {
            const count = counts[lane.id];
            return (
              <span
                key={lane.id}
                className="mob-lane-cell"
                data-tone={lane.tone}
                data-empty={flag(count === 0)}
                data-selected={flag(index === selected)}
                data-lane-cell={lane.id}
              >
                <b className="mob-lane-count">{count}</b>
                <i className="mob-lane-bar" />
                <span className="mob-lane-label">{lane.shortLabel}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="mob-lane-head">
        <div className="mob-lane-titles">
          {PHONE_LANES.map((lane, index) => {
            const place: CSSProperties & { "--lane-index": number } = { "--lane-index": index };
            return (
              <span key={lane.id} className="mob-lane-title" data-tone={lane.tone} style={place}>
                <i className="mob-lane-title-bar" />
                <span className="mob-lane-title-text">{lane.title}</span>
                <span className="mob-lane-total">{laneCountLabel(counts[lane.id])}</span>
              </span>
            );
          })}
        </div>
        <span className="mob-lane-filters">
          <Funnel />
          Filters
        </span>
      </div>
    </div>
  );
}
