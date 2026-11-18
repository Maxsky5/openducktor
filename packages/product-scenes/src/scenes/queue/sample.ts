// The sample data of the queue scene: the Builder of the search shortcut task runs the search
// tests, and the developer queues two messages. The messages and the times are fictional.
import type { CallData } from "../../replicas/transcript/model";
import { bash, catFile, edit, readTask } from "../../sample/calls";
import { BUILD_FILES, BUILDER_SESSION, TASK_ID } from "../../sample/studio";

/** The Builder session of the build turn. */
export const QUEUE_SESSION = BUILDER_SESSION;

/** The queued messages in delivery order. The developer steers the second one. */
export const QUEUED = {
  next: { id: "next", text: "Then list Cmd+K in the Help menu." },
  steer: { id: "steer", text: "Run the keymap tests too." },
} as const;

/** The times of the edits of the build, in the order of BUILD_FILES. */
const EDIT_TIMES = ["09:47:10 AM", "09:47:31 AM", "09:47:58 AM", "09:48:24 AM"];

/**
 * The calls of the build turn until the search tests, which run when the developer queues the
 * messages. They show as one long tool run, with its latest calls under the bar of the others.
 */
export const BUILD_CALLS: readonly CallData[] = [
  readTask(TASK_ID, "131ms", "09:46:32 AM"),
  catFile("read-guide", "AGENTS.md", "6ms", "09:46:35 AM"),
  ...BUILD_FILES.map((file, index) =>
    edit(
      `patch-${index}`,
      file.path,
      { add: file.add, del: file.del },
      "41ms",
      EDIT_TIMES[index] ?? "",
    ),
  ),
  bash("search-tests", "bun test src/search", "2.4s", "09:48:51 AM"),
];

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
