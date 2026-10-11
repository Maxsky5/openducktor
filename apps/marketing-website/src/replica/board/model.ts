// The data of a Kanban board in a view: the cards of each lane, with the task and the button or
// the session of each card.
import type { TaskKey } from "../../sample/tasks";
import type { CardAction, LaneId, Role, SessionStatus } from "../vocabulary";

/** The agent session of a card. */
type CardSession = { role: Role; status: SessionStatus };

/** The action group of a card: the button of its next step, or its running session. */
export type CardActionsData = { action?: CardAction; session?: CardSession };

export type CardData = {
  task: TaskKey;
  /** The name that the scene of the view uses to find the card. */
  name?: string;
  action?: CardAction;
  session?: CardSession;
  /** The number of the pull request of the task. */
  pr?: number;
  /** The last QA review rejected the build. */
  rejected?: boolean;
  /** The roles of the saved sessions that the card links to, other than its main action. */
  links?: readonly Role[];
};

/** The cards of a board by lane. A lane without cards is collapsed. */
export type BoardData = Partial<Record<LaneId, readonly CardData[]>>;
