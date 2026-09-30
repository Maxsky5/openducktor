// Sample data of the worktree tile. The commands, the output, and the apps are fictional.
// Sources: agent-studio-dev-server-panel.tsx, open-in-menu.tsx, the dev server service of
// packages/host, and the macOS catalog in packages/host/src/adapters/open-in-tools.
import { TASK_ID } from "./studio";
import { CONFIG_PATH, WORKSPACE } from "./workspace";

/** The default worktree of a task: <config directory>/worktrees/<workspace id>/<task id>. */
export const WORKTREE_PATH = `${CONFIG_PATH}/worktrees/${WORKSPACE}/${TASK_ID}`;

/**
 * One terminal line. The host sets FORCE_COLOR, so the tools write ANSI colors. xterm draws bold
 * colored text in the bright color of the palette.
 */
type TerminalLine = {
  text: string;
  tone?: "dim" | "bold" | "green" | "cyan" | "green bold" | "cyan bold";
}[];

export type DevServer = {
  id: string;
  name: string;
  command: string;
  /** The output at the end of the scene. The host writes the first line. */
  lines: TerminalLine[];
};

const started = (command: string): TerminalLine => [{ text: `Starting \`${command}\`` }];

export const DEV_SERVERS: DevServer[] = [
  {
    id: "web",
    name: "web",
    command: "bun run dev",
    lines: [
      started("bun run dev"),
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
  },
  {
    id: "api",
    name: "api",
    command: "bun run api",
    lines: [
      started("bun run api"),
      [{ text: "$ bun --watch src/server.ts", tone: "dim" }],
      [{ text: "Listening on " }, { text: "http://localhost:8787", tone: "cyan" }],
      [{ text: "GET /api/notes " }, { text: "200", tone: "green" }, { text: " 14ms", tone: "dim" }],
      [
        { text: "GET /api/search?q=tags " },
        { text: "200", tone: "green" },
        { text: " 9ms", tone: "dim" },
      ],
    ],
  },
];

/** The preferred app of the sample settings. The menu lists the other installed apps. */
/** A tool that opens a worktree, with the fallback icon that the product shows without an app icon. */
export type OpenInTool = { label: string; icon: "folder" | "terminal" | "app" };

/** Installed apps in catalog order. */
export const OPEN_IN_TOOLS = [
  { label: "Finder", icon: "folder" },
  { label: "Terminal", icon: "terminal" },
  { label: "Ghostty", icon: "terminal" },
  { label: "Cursor", icon: "app" },
  { label: "Zed", icon: "app" },
  { label: "WebStorm", icon: "app" },
] as const satisfies readonly OpenInTool[];

/** The default tool of the Open In button in the worktree view: the tool that opened it last. */
export const OPEN_IN_DEFAULT: OpenInTool = { label: "VS Code", icon: "app" };

/** The default tool of the Open In button in the workflow steps. */
export const OPEN_IN_TERMINAL: OpenInTool = OPEN_IN_TOOLS[1];

/** The app that the scene chooses in the menu. */
export const OPEN_IN_CHOICE = "Cursor";
