// The sample data of the Steer scene of the mobile app. The Builder of the search shortcut task
// runs the search tests. While a turn runs, Send queues the message, and the zap button next to it
// steers it. The messages and the times are fictional.
import type { MobileTool } from "../../replicas/mobile/TranscriptRows";
import { BUILDER_TOOLS } from "../../sample/mobile";

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
  readTest: {
    type: "read",
    name: "read",
    summary: "src/search/use-search-shortcut.test.ts",
    duration: "1ms",
    time: "9:48:58 AM",
  },
  keymapTests: {
    type: "bash",
    name: "bash",
    summary: "bun test src/search src/app",
    duration: "3.1s",
    time: "9:49:04 AM",
  },
} as const satisfies Record<string, MobileTool>;

/** The reply of the Builder before the scene starts. */
export const READY =
  "The hook and the search dialog are ready. I run the search tests to check them.";

/** The reply of the Builder to the steered message. */
export const ANSWER =
  "The hook already takes `Ctrl+K` on Windows and Linux. I add a test for each platform.";
