// The sample data of the import session scene: the board and the sidebar of the first frame, the
// runtimes and the external sessions of the Import session dialog, the search, and the imported
// conversation. The sessions, their IDs, the messages, and the model are fictional.
import type { BoardData } from "../../replicas/board/model";
import type { NavData, NavEntry } from "../../replicas/shell/nav";
import type { ExternalSession, ImportRuntime } from "../../replicas/studio/import-session-text";
import { CARDS } from "../../sample/board";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import { REPOSITORY_PATH, WORKSPACE } from "../../sample/workspace";

/** The issue import of a workspace with the GitHub provider. */
export const ISSUE_IMPORT = "Import tasks from GitHub Issues";

/** The runtimes of the option list, with the labels of their definitions. */
export const RUNTIMES: readonly ImportRuntime[] = [
  { kind: "opencode", label: "OpenCode" },
  { kind: "codex", label: "Codex" },
  { kind: "claude", label: "Claude" },
];

/** The runtime that the visitor chooses. */
export const RUNTIME: ImportRuntime = { kind: "claude", label: "Claude" };

/** A Git worktree of the repository that the user added outside OpenDucktor. */
const TAGS_WORKTREE = `${REPOSITORY_PATH}-tags`;

/** The conversation that the visitor imports. */
export const IMPORTED: ExternalSession = {
  id: "7c1e4b2a-93d5-4f08-b6a1-2e8d5c0f9a34",
  title: "Speed up search in large notebooks",
  directory: REPOSITORY_PATH,
  updated: "2h ago",
};

/** The conversations that Claude Code has in the repository and in its worktree, newest first. */
export const SESSIONS: readonly ExternalSession[] = [
  IMPORTED,
  {
    id: "e5a90f3c-1b7d-4c62-8e44-9d03a6b1f7c8",
    title: "Fix the sync retry after offline mode",
    directory: REPOSITORY_PATH,
    updated: "1d ago",
  },
  {
    id: "3f8b6d10-c2e9-47a5-9b3e-61a4d7e2c05b",
    title: "Search notes by tag name",
    directory: TAGS_WORKTREE,
    updated: "3d ago",
  },
  {
    id: "b04d7e9a-58c1-4e3f-a2d6-0c9f1b8e3a72",
    title: "Review the export to Markdown",
    directory: REPOSITORY_PATH,
    updated: "6d ago",
  },
];

/** The search that the visitor types. It matches the title, the session ID, or the directory. */
export const SEARCH = "search";

/** The rows that match the search. */
export const MATCHES = SESSIONS.filter((session) =>
  [session.title, session.id, session.directory].some((value) =>
    value.toLowerCase().includes(SEARCH),
  ),
).map((session) => session.id);

/** The model of the imported conversation, which the import keeps. */
export const SESSION = {
  runtime: "claude",
  model: "claude-lyra-3",
  effort: "high",
  window: 200_000,
  used: 18.4,
} satisfies Session;

/** The turn of the conversation in Claude Code, which the session page shows after the import. */
export const TURN = {
  message: "Find why search is slow in large notebooks.",
  time: "8:12:40 AM",
  worked: "1m 06s",
  reply:
    "Search reads every note from disk for each query. An index of the words in each note lets a query read only the notes that match.",
} as const;

/** The follow-up that the visitor sends in OpenDucktor. */
export const FOLLOW_UP = "Build the index in a background worker.";

/** The imported session in the sidebar. It shows when it opens. */
export const ENTRY = {
  workspace: WORKSPACE,
  id: "imported",
  title: IMPORTED.title,
  runtime: SESSION.runtime,
} as const satisfies NavEntry;

/**
 * The sidebar of the workspace: a Builder runs, and a workspace session is recent. The short window
 * leaves out the empty Needs you group, so it shows the imported session in Recent and in Running.
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
export type ImportSessionTemplate = "menu";
