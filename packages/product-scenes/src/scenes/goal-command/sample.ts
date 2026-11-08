// The sample data of the goal command scene: a Builder session of a bug on OpenCode, which can pause
// and resume a goal. OpenCode writes the message of a new goal into the session, so the transcript
// shows it as /goal with the objective. The model, the files, and the times are fictional.
import type { Session } from "../../sample/sessions";

/** The Builder session on OpenCode with the build agent. */
export const COMMAND_SESSION = {
  runtime: "opencode",
  model: "vega-2-pro",
  effort: "high",
  window: 1_000_000,
  used: 6.8,
} satisfies Session;

/** The agent profile of the session. */
export const AGENT = "build";

/** The /goal command of OpenDucktor: GOAL_SLASH_COMMAND of slash-command-schemas.ts. */
export const GOAL_COMMAND = {
  trigger: "goal",
  source: "system",
  description: "Keep working until the objective is met",
  hint: "<objective> | pause | resume | clear",
} as const;

/** The slash query that the visitor types to find /goal. */
export const QUERY = "/go";

/** The objective that the visitor types after the goal chip. */
export const OBJECTIVE =
  "Keep the tags of a note when it moves to another notebook. Add a test for the move, and make bun test src/notes pass.";

/** The goal action that the visitor types later. */
export const PAUSE = "pause";

/** The file of the fix and its test. */
export const FIX_PATH = "src/notes/move-note.ts";
export const TEST_PATH = "src/notes/move-note.test.ts";

/** The times of the rows of the goal turn. */
export const TIMES = { goal: "10:12:04 AM", read: "10:12:07 AM", run: "10:12:41 AM" };
