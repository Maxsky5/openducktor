// The sample data of the fork scene: the workspace session and its two turns, the folder and the
// worktree of the Fork session dialog, the startup steps of the new worktree, and the sidebar.
// The session, the messages, and the model are fictional.
import type { NavData, NavEntry } from "../../replicas/shell/nav";
import type { ForkSource, ForkWorktree } from "../../replicas/studio/ForkDialog";
import type { StartupStep } from "../../replicas/studio/StartupProgress";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import { CONFIG_PATH, WORKSPACE } from "../../sample/workspace";

/** The model of the source session, which the fork keeps. */
export const SESSION = {
  runtime: "codex",
  model: "gpt-6-astra",
  effort: "high",
  window: 400_000,
  used: 12.6,
  speed: "standard",
} satisfies Session;

/** The title of the source session. */
export const TITLE = "Profile the slow search";

/** The title of the fork: the host adds ` (fork)` to the title of the source. */
export const FORK_TITLE = `${TITLE} (fork)`;

/** The default branch prefix of a repository. */
export const BRANCH_PREFIX = "odt";

/**
 * The worktree of the source session: <config directory>/worktrees/<workspace id>/
 * workspace-sessions/<worktree name>.
 */
export const SOURCE: ForkSource = {
  name: "search-profile",
  branch: `${BRANCH_PREFIX}/search-profile`,
  directory: `${CONFIG_PATH}/worktrees/${WORKSPACE}/workspace-sessions/search-profile`,
};

/** The worktree that the form suggests for a fork of a worktree session: the folder and -fork. */
export const WORKTREE: ForkWorktree = {
  name: `${SOURCE.name}-fork`,
  directory: `${SOURCE.name}-fork`,
  branch: `${BRANCH_PREFIX}/${SOURCE.name}-fork`,
};

/** The origin of the startup progress: the repository and the scope. */
export const ORIGIN = `${WORKSPACE} · Workspace session`;

/**
 * The startup steps of a new worktree on a new branch from a remote target, without copied files
 * or worktree actions. The worktree and the upstream steps have details.
 */
export const STEPS: readonly StartupStep[] = [
  { id: "checkout", label: "Create workspace worktree", details: true },
  { id: "upstream", label: "Set branch upstream", details: true },
  { id: "session", label: "Start session", details: false },
];

/** The two turns of the source session. The fork keeps the first one. */
export const TURNS = {
  first: {
    message: "Find why search is slow in large notebooks, and suggest a fix.",
    time: "10:31:08 AM",
    worked: "52s",
    reply:
      "Search reads every note from disk for each query. An index of the words in each note lets a query read only the notes that match.",
  },
  second: {
    message: "Build the index in a background worker.",
    time: "10:33:40 AM",
    worked: "1m 14s",
    reply: "The worker builds the index when a notebook opens, and search now reads the index.",
  },
} as const;

/** The other follow-up that the visitor sends in the fork. */
export const FOLLOW_UP = "Cache the results of recent queries instead of an index.";

/** The source session in the sidebar: a workspace session in Recent. */
export const SOURCE_ENTRY = {
  workspace: WORKSPACE,
  id: "fork-source",
  title: TITLE,
  runtime: SESSION.runtime,
  time: "1m",
  selected: true,
} as const satisfies NavEntry;

/** The fork in the sidebar. It shows when it opens. */
export const FORK_ENTRY = {
  workspace: WORKSPACE,
  id: "fork-child",
  title: FORK_TITLE,
  runtime: SESSION.runtime,
} as const satisfies NavEntry;

/**
 * The sidebar of the workspace: a Builder runs, and the source session is recent. The short window
 * leaves out the empty Needs you group, so it shows the fork in Recent and in Running.
 */
export const NAV: NavData = {
  scope: "current",
  entries: [{ ...FORK_ENTRY, later: true }, SOURCE_ENTRY, NAV_SESSIONS["shortcut-build"]],
  omitted: ["needs_you"],
};
