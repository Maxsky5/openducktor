// The data and the templates of the palette view: the board behind the palette, the sidebar of
// all workspaces, and the changes that the palette commands make.
import type { BoardData, CardActionsData } from "../../replica/board/model";
import type { NavData } from "../../replica/shell/nav";
import { type Notification, sessionNotification } from "../../replica/vocabulary";
import { CARDS } from "../../sample/board";
import { NAV_SESSIONS } from "../../sample/nav";
import { TASKS } from "../../sample/tasks";

/** The board under the palette: the task to plan, the Builder that waits, and the others. */
export const PALETTE_BOARD: BoardData = {
  spec_ready: [CARDS.titles],
  in_progress: [
    { ...CARDS.empty, session: { role: "Builder", status: "Waiting input" } },
    CARDS.shortcut,
  ],
  ai_review: [CARDS.focus],
  human_review: [CARDS.typing],
};

/** The sidebar of all workspaces: the Builder of the empty notebook task waits for you. */
export const PALETTE_NAV: NavData = {
  scope: "all",
  entries: [
    { ...NAV_SESSIONS["empty-build"], running: false, attention: "Question" },
    NAV_SESSIONS["shortcut-build"],
    NAV_SESSIONS["focus-qa"],
    NAV_SESSIONS["api-build"],
    NAV_SESSIONS["titles-spec"],
    NAV_SESSIONS["typing-qa"],
    NAV_SESSIONS["tags-chat"],
    NAV_SESSIONS["theme-plan"],
    { ...NAV_SESSIONS["titles-planner"], later: true },
  ],
};

/** The buttons of the cards that change. */
export const CARD_ACTIONS = {
  "planner-starting": { session: { role: "Planner", status: "Starting" } },
  "planner-running": { session: { role: "Planner", status: "Running" } },
  "builder-running": { session: { role: "Builder", status: "Running" } },
} as const satisfies Record<string, CardActionsData>;

/** The notification of the Planner session that starts in the background. */
export const STARTED: Notification = sessionNotification("Planner", TASKS.h5w3.title);

export type PaletteTemplate = keyof typeof CARD_ACTIONS | "planner-dialog" | "toast-started";
