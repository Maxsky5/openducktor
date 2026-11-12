// The sample data of the terminal scene: the command that the visitor types in a new terminal,
// its output, and the output of the Test action. The output is fictional. Sources:
// docs/interactive-terminal-architecture.md and terminal-session-producer.ts.
import type { TerminalLine } from "../../sample/actions";
import { PROMPT } from "../../sample/terminal";
import { TASK_BRANCH } from "../../sample/worktree";

/** The tooltips of the panel toggles while their panels are hidden: session-view-controls.tsx. */
export const PANEL_TIPS = { bottom: "Show bottom panel", right: "Show right panel" } as const;

/** The command that the visitor types in the new terminal. */
export const TYPED_COMMAND = "git status";

export const GIT_STATUS_OUTPUT: readonly TerminalLine[] = [
  [{ text: `On branch ${TASK_BRANCH}` }],
  [{ text: "nothing to commit, working tree clean" }],
];

/** zsh runs each line of an action at the prompt, as if pasted. The host skips the comment. */
const actionLine = (line: string): TerminalLine => [{ text: PROMPT }, { text: line }];

const pass = (name: string, time: string): TerminalLine => [
  { text: "✓", tone: "green" },
  { text: ` ${name} ` },
  { text: `[${time}]`, tone: "dim" },
];

/** The output of the Test action, one entry for each line of the terminal. */
export const TEST_OUTPUT: readonly TerminalLine[] = [
  actionLine("bun install"),
  [
    { text: "bun install ", tone: "bold" },
    { text: "v1.3.4 (5eb2145b)", tone: "dim" },
  ],
  [],
  [
    { text: "Checked " },
    { text: "214", tone: "green" },
    { text: " installs across 236 packages " },
    { text: "(no changes)", tone: "dim" },
    { text: " [38.00ms]", tone: "dim" },
  ],
  actionLine("bun test"),
  [
    { text: "bun test ", tone: "bold" },
    { text: "v1.3.4 (5eb2145b)", tone: "dim" },
  ],
  [],
  [{ text: "src/search/use-search-shortcut.test.ts:" }],
  pass("search shortcut > opens search with Cmd+K", "1.42ms"),
  pass("search shortcut > ignores Cmd+K in a text field", "0.31ms"),
  pass("search shortcut > closes search with Escape", "0.27ms"),
  [],
  [{ text: "src/app/keymap.test.ts:" }],
  pass("keymap > binds Cmd+Shift+K", "0.18ms"),
  [],
  [{ text: " 4 pass", tone: "green" }],
  [{ text: " 0 fail", tone: "dim" }],
  [{ text: " 9 expect() calls" }],
  [{ text: "Ran 4 tests across 2 files. " }, { text: "[184.00ms]", tone: "dim" }],
];
