// The repository actions of the Fieldnotes repository, in the saved order of the settings. The
// commands and their output are fictional. Sources: config-schemas.ts for the icons, and
// repo-actions-split-button.tsx for the menu.

/** The icons that an action can have, from repo-action-icons.ts. */
export type RepoActionIcon = "play" | "test" | "lint" | "configure" | "build" | "debug";

export type RepoAction = {
  name: string;
  icon: RepoActionIcon;
  /** The command lines. The host prints each line before it runs it. */
  lines: readonly string[];
  /** The top bar runs the default action. The menu lists the other actions. */
  isDefault?: boolean;
};

/** The actions by id. Worktree setup runs when OpenDucktor creates a worktree. */
export const REPO_ACTIONS = {
  setup: { name: "Worktree setup", icon: "configure", lines: ["bun install"] },
  web: { name: "Web", icon: "play", lines: ["bun run dev"], isDefault: true },
  api: { name: "API", icon: "play", lines: ["bun run api"] },
  test: { name: "Tests", icon: "test", lines: ["bun test"] },
} as const satisfies Record<string, RepoAction>;

/**
 * One terminal line. The tools write ANSI colors, and xterm draws bold colored text in the bright
 * color of the palette.
 */
export type TerminalLine = {
  text: string;
  tone?: "dim" | "bold" | "green" | "cyan" | "green bold" | "cyan bold";
}[];

/** The host prints each command line of action `id` in dim text before the login shell runs it. */
function commandLines(id: keyof typeof REPO_ACTIONS): TerminalLine[] {
  return REPO_ACTIONS[id].lines.map((line) => [{ text: `$ ${line}`, tone: "dim" }]);
}

/** The output of the actions that the actions view runs, as the terminals show it. */
export const ACTION_OUTPUT = {
  web: [
    ...commandLines("web"),
    [{ text: "$ vite", tone: "dim" }],
    [],
    [
      { text: "  " },
      { text: "VITE", tone: "green bold" },
      { text: " v7.1.4", tone: "green" },
      { text: "  ready in ", tone: "dim" },
      { text: "412", tone: "bold" },
      { text: " ms", tone: "dim" },
    ],
    [],
    [
      { text: "  " },
      { text: "➜", tone: "green" },
      { text: "  " },
      { text: "Local", tone: "bold" },
      { text: ":   " },
      { text: "http://localhost:", tone: "cyan" },
      { text: "5173", tone: "cyan bold" },
      { text: "/", tone: "cyan" },
    ],
  ],
  api: [
    ...commandLines("api"),
    [{ text: "$ bun --watch src/server.ts", tone: "dim" }],
    [{ text: "Listening on " }, { text: "http://localhost:8787", tone: "cyan" }],
    [{ text: "GET /api/notes " }, { text: "200", tone: "green" }, { text: " 14ms", tone: "dim" }],
    [
      { text: "GET /api/search?q=tags " },
      { text: "200", tone: "green" },
      { text: " 9ms", tone: "dim" },
    ],
  ],
} satisfies Partial<Record<keyof typeof REPO_ACTIONS, readonly TerminalLine[]>>;
