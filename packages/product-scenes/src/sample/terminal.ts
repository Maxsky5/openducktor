// Sample data of the terminals of a task worktree: the repository actions of the terminal and
// browser scenes, the first label of a new terminal, and the zsh prompt. Test is the default
// action, as the Add repository actions section of the docs adds it. Sources:
// docs/interactive-terminal-architecture.md and terminal-session-producer.ts.
import type { RepoAction } from "./actions";
import { WORKTREE_PATH } from "./worktree";

/** The repository actions of the scenes. Test is the default action, so the top bar runs it. */
export const TERMINAL_ACTIONS = {
  test: {
    name: "Test",
    icon: "test",
    lines: ["# Install, then test.", "bun install", "bun test"],
    isDefault: true,
  },
  web: { name: "Web", icon: "play", lines: ["bun run dev"] },
  api: { name: "API", icon: "play", lines: ["bun run api"] },
} as const satisfies Record<string, RepoAction>;

/** The first title of a terminal is its start directory: the worktree of the task. */
export const SHELL_LABEL = WORKTREE_PATH;

/** The default zsh prompt of macOS: the user, the host, and the current folder. */
export const PROMPT = "sam@mac fieldnotes-k3x9 % ";
