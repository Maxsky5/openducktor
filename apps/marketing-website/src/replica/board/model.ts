// The data of a Kanban board in a view: the cards of each lane, with the task and the button or
// the session of each card.
import type { TaskKey } from "../../sample/tasks";
import type { CardAction, LaneId, Role, SessionStatus } from "../vocabulary";

/** The agent session of a card. */
type CardSession = { role: Role; status: SessionStatus };

/** The footer of a card: the button of its next step, or its running session. */
export type CardActionsData = { action?: CardAction; session?: CardSession };

export type CardData = {
  task: TaskKey;
  /** The name that the scene of the view uses to find the card. */
  name?: string;
  action?: CardAction;
  session?: CardSession;
  /** The number of the pull request of the task. */
  pr?: number;
};

/** The cards of a board by lane. A lane without cards is collapsed. */
export type BoardData = Partial<Record<LaneId, readonly CardData[]>>;

/** The agent activity of the sidebar: the sessions that run or wait, and the ones that wait. */
export type ActivityCounts = { sessions: number; waiting: number };

/** The agent activity of the tasks of `board`. */
export function boardActivity(board: BoardData): ActivityCounts {
  const sessions = Object.values(board).flatMap((cards) =>
    cards.flatMap((card) => card.session ?? []),
  );
  return {
    sessions: sessions.length,
    waiting: sessions.filter((session) => session.status === "Waiting input").length,
  };
}
