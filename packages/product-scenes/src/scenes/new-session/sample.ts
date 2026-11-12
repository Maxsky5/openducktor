// The sample data of the new session scene: the board and the sidebar of the first frame, the
// choices of the New session dialog, the startup steps of a new worktree, and the first message.
// The session names and the model are fictional.
import type { BoardData } from "../../replicas/board/model";
import type { NavData, NavEntry } from "../../replicas/shell/nav";
import type { StartupStep } from "../../replicas/studio/StartupProgress";
import type { WorktreeName } from "../../replicas/studio/WorktreeFields";
import { CARDS } from "../../sample/board";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import { WORKSPACE } from "../../sample/workspace";

/** The Default Model of the repository, which the dialog keeps. Nothing uses its context yet. */
export const SESSION = {
  runtime: "codex",
  model: "gpt-6-astra",
  effort: "high",
  window: 400_000,
  used: 0,
  speed: "standard",
} satisfies Session;

/** The issue import of a workspace with the GitHub provider. */
export const ISSUE_IMPORT = "Import tasks from GitHub Issues";

/** The session name that the visitor types. */
export const NAME = "Profile the slow search";

/** The default target branch of the repository. */
export const TARGET = "origin/main";

/** The default branch prefix of a repository. */
export const BRANCH_PREFIX = "odt";

/** The worktree name that the visitor types, and the directory and the branch that it makes. */
export const WORKTREE: WorktreeName = {
  name: "search-profile",
  directory: "search-profile",
  branch: `${BRANCH_PREFIX}/search-profile`,
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

/** The first message that the visitor sends. */
export const MESSAGE = "Find why search is slow in large notebooks, and suggest a fix.";

/** The new session in the sidebar. It shows when it opens. */
export const ENTRY = {
  workspace: WORKSPACE,
  id: "new-session",
  title: NAME,
  runtime: SESSION.runtime,
} as const satisfies NavEntry;

/**
 * The sidebar of the workspace: a Builder runs, and a workspace session is recent. The short window
 * leaves out the empty Needs you group, so it shows the new session in Recent and in Running.
 */
export const NAV: NavData = {
  scope: "current",
  entries: [{ ...ENTRY, later: true }, NAV_SESSIONS["shortcut-build"], NAV_SESSIONS["tags-chat"]],
  omitted: ["needs_you"],
};

/** The lanes of the board that the window shows. */
export const LANES = ["open", "spec_ready", "in_progress"] as const;

export const BOARD: BoardData = {
  open: [CARDS.export, CARDS.sync],
  spec_ready: [CARDS.titles],
  in_progress: [CARDS.shortcut],
};

/** The menu of the arrow beside New task. */
export type NewSessionTemplate = "menu";
