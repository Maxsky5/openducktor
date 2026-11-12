// The sample data of the queue scene: the Builder of the search shortcut task runs the search
// tests, and the developer queues two messages. The messages and the times are fictional.
import { BUILDER_SESSION } from "../../sample/studio";

/** The Builder session of the build turn. */
export const QUEUE_SESSION = BUILDER_SESSION;

/** The queued messages in delivery order. The developer steers the second one. */
export const QUEUED = {
  next: { id: "next", text: "Then list Cmd+K in the Help menu." },
  steer: { id: "steer", text: "Run the keymap tests too." },
} as const;

/** The rows of the turn: the tests that run when the developer queues the messages. */
export const TESTS = {
  search: { args: "bun test src/search", duration: "2.4s", time: "09:48:51 AM" },
  keymap: { args: "bun test src/search src/app", duration: "3.1s", time: "09:49:04 AM" },
};

/** The times of the user messages: the kickoff, the steered message, and the queued message. */
export const SENT = { kickoff: "09:46:30 AM", steer: "09:48:53 AM", next: "09:49:15 AM" };

/** The search of the next turn, which starts with the queued message. */
export const HELP_SEARCH = { args: "Help in src", time: "09:49:17 AM" };
