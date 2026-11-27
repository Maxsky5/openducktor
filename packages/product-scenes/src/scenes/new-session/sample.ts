// The sample data of the new session scene: the board and the sidebar of the first frame, the
// choices of the draft page, the first message, the names that the naming model gives, the startup
// steps of a new worktree, and the first calls of the agent. The names, the model, and the files
// are fictional.
import type { BoardData } from "../../replicas/board/model";
import type { NavData, NavEntry } from "../../replicas/shell/nav";
import type { StartupStep } from "../../replicas/studio/StartupProgress";
import { bash, catFile } from "../../sample/calls";
import { CARDS } from "../../sample/board";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import { WORKSPACE } from "../../sample/workspace";

/** The Default Model of the repository, which the draft keeps. Nothing uses its context yet. */
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

/** The default target branch of the repository. */
export const TARGET = "main";

/** The default branch prefix of a repository. */
export const BRANCH_PREFIX = "odt";

/** The placeholder of the empty branch name of a new worktree with the default prefix. */
export const BRANCH_PLACEHOLDER = `${BRANCH_PREFIX}/my-branch`;

/**
 * The empty Branch changes of the new worktree, as emptyDiffCopy of empty-diff-copy.ts words it
 * against the target branch.
 */
export const EMPTY_DIFF = `No changes against ${TARGET}`;

/** The first message that the visitor sends. */
export const MESSAGE = "Find why search is slow in large notebooks.";

/** The branch and the session title that the naming model gives from the first message. */
export const NAMED = {
  branch: "perf/slow-notebook-search",
  title: "Profile the slow search",
} as const;

/**
 * The startup steps of a new worktree on a new branch from a local target, with a naming model,
 * without copied files or worktree actions. The naming step gets its details when it completes.
 */
export const STEPS: readonly StartupStep[] = [
  {
    id: "naming",
    label: "Generate branch name and session title",
    details: "completed",
    detail: NAMED.branch,
  },
  { id: "checkout", label: "Create workspace worktree", details: true },
  { id: "prepare", label: "Start session", details: false },
  { id: "instruction", label: "Submit initial instruction", details: "completed" },
];

/**
 * The part of the context window in percent that the session uses once the agent works, which the
 * context meter shows: 18.4K of the 400K tokens.
 */
export const CONTEXT_USED = 4.6;

/** The time of the first message, which takes the place of Sending… when the runtime has it. */
export const SENT_TIME = "10:31:08 AM";

/** The first calls of the agent: it searches the code for searchNotes, then reads the note index. */
export const CALLS = [
  bash("find-search", "rg -n 'searchNotes' src", "86ms", "10:31:11 AM", "search"),
  catFile("read-index", "src/search/note-index.ts", "14ms", "10:31:12 AM"),
] as const;

/** The draft in the sidebar. It shows when the draft page opens. */
export const ENTRY = {
  workspace: WORKSPACE,
  id: "new-session",
  title: "New session",
  laterRuntime: SESSION.runtime,
  draft: "draft",
  time: "now",
} as const satisfies NavEntry;

/**
 * The sidebar of the last frame: the draft with the typed message at the top of Recent, a Builder
 * that runs, and a workspace session of earlier.
 */
export const NAV: NavData = {
  scope: "current",
  entries: [
    { ...ENTRY, title: MESSAGE, selected: true },
    NAV_SESSIONS["shortcut-build"],
    NAV_SESSIONS["tags-chat"],
  ],
};

/** The lanes of the board that the window shows. */
export const LANES = ["open", "spec_ready", "in_progress"] as const;

export const BOARD: BoardData = {
  open: [CARDS.export, CARDS.sync],
  spec_ready: [CARDS.titles],
  in_progress: [CARDS.shortcut],
};

/** The menu of the arrow beside New task, and the popovers of the options bar. */
export type NewSessionTemplate = "menu" | "location" | "branch";
