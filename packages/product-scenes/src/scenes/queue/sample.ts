// The sample data of the queue scene: the Builder of the search shortcut task runs the search
// tests, and the developer queues two messages. The messages and the times are fictional.
import { bash } from "../../sample/calls";
import { BUILDER_SESSION } from "../../sample/studio";

/** The Builder session of the build turn. */
export const QUEUE_SESSION = BUILDER_SESSION;

/** The queued messages in delivery order. The developer steers the second one. */
export const QUEUED = {
  next: { id: "next", text: "Then list Cmd+K in the Help menu." },
  steer: { id: "steer", text: "Run the keymap tests too." },
} as const;

/** The tests that the agent adds to the run after the steered message. */
export const KEYMAP_TESTS = bash(
  "keymap-tests",
  "bun test src/search src/app",
  "3.1s",
  "09:49:04 AM",
);

/** The times of the user messages: the kickoff, the steered message, and the queued message. */
export const SENT = { kickoff: "09:46:30 AM", steer: "09:48:53 AM", next: "09:49:15 AM" };

/** The search of the next turn, which starts with the queued message. Codex runs it in a shell. */
export const HELP_SEARCH = bash("help-search", 'rg -n "Help" src', "64ms", "09:49:17 AM", "search");
