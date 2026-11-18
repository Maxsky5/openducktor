// The sample data of the goal command scene: a Builder session of a bug on OpenCode, which can pause
// and resume a goal. OpenCode writes the message of a new goal into the session, so the transcript
// shows it as /goal with the objective. The model, the files, and the times are fictional.
import type { CallData } from "../../replicas/transcript/model";
import { bash, call, edit } from "../../sample/calls";
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

/** The time of the goal message. */
export const GOAL_TIME = "10:12:04 AM";

/**
 * The calls of the goal turn, which show as one tool run. OpenCode names its read tool `read`. The
 * run folds when the final message of the turn comes.
 */
export const GOAL_CALLS: readonly CallData[] = [
  call("read", {
    tool: "read",
    name: "read",
    summary: FIX_PATH,
    file: true,
    duration: "9ms",
    time: "10:12:07 AM",
  }),
  edit("fix", FIX_PATH, { add: 4, del: 1 }, "28ms", "10:12:16 AM"),
  edit("test", TEST_PATH, { add: 18, del: 0 }, "31ms", "10:12:29 AM"),
  bash("run", "bun test src/notes", "2.1s", "10:12:41 AM"),
];
