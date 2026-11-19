// The sample data of the Steer scene of the mobile app. The Builder of the search shortcut task
// runs the search tests. While a turn runs, Send queues the message, and the zap button next to it
// steers it. The messages and the times are fictional.
import type { MobileCall } from "../../replicas/mobile/ToolRun";
import { BUILDER_TOOLS, codexCommand } from "../../sample/mobile";

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "While the agent works, Send queues your message.",
  "Tap the queued message, then its zap button.",
  "The agent reads the message in its running turn.",
  "To steer a new message at once, tap the zap button.",
] as const;

/** The messages of the visitor: the first one goes to the queue, the second one steers at once. */
export const MESSAGES = {
  queued: { text: "Also handle Ctrl+K on Windows and Linux.", time: "9:48:44 AM" },
  steered: { text: "Then run the keymap tests too.", time: "9:49:02 AM" },
} as const;

/** The tool calls of the turn, in order. */
export const TOOLS = {
  guide: BUILDER_TOOLS.guide,
  keymap: BUILDER_TOOLS.keymap,
  list: BUILDER_TOOLS.list,
  search: BUILDER_TOOLS.search,
  shell: BUILDER_TOOLS.shell,
  dialog: BUILDER_TOOLS.dialog,
  test: { ...BUILDER_TOOLS.test, time: "9:48:41 AM" },
  readTest: codexCommand(
    "read",
    "cat src/search/use-search-shortcut.test.ts",
    "16ms",
    "9:48:58 AM",
  ),
  keymapTests: codexCommand("bash", "bun test src/search src/app", "3.1s", "9:49:04 AM"),
} as const satisfies Record<string, MobileCall>;

/**
 * The tool runs of the turn: consecutive calls make one run. A run folds when its calls all ended
 * and another row follows it.
 */
export const RUNS = {
  lookups: ["guide", "keymap", "list", "search", "shell", "dialog"],
  tests: ["test"],
  testRead: ["readTest"],
  keymapTests: ["keymapTests"],
} as const satisfies Record<string, readonly (keyof typeof TOOLS)[]>;

/** The reply of the Builder before the scene starts. */
export const READY =
  "The hook and the search dialog are ready. I run the search tests to check them.";

/** The reply of the Builder to the steered message. */
export const ANSWER =
  "The hook already takes `Ctrl+K` on Windows and Linux. I add a test for each platform.";
