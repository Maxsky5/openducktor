// The sample data of the Needs you scene of the mobile app. The Builder of the search shortcut task
// runs on Codex and asks to run the search tests. Codex asks with a command approval: its title,
// its default summary, the command and its folder, and the action come from
// codex-app-server-requests.ts in packages/adapters-codex-app-server. Codex classes `bun test` as
// an unknown command, so the card says "Effect unknown". The reply labels come from
// APPROVAL_OUTCOME_LABELS of agent-session-approval-card-model.ts in packages/frontend-core. The
// times are fictional.
import type { RailStep } from "../../replicas/mobile/MobileRail";
import type { PermissionRequest } from "../../replicas/mobile/PermissionCard";
import type { MobileCall } from "../../replicas/mobile/ToolRun";
import type { NavEntry } from "../../replicas/shell/nav";
import type { RoleId } from "../../replicas/vocabulary";
import {
  BUILDER_RAIL,
  BUILDER_TOOLS,
  codexCommand,
  PHONE_SESSIONS,
  WAITING_BUILD,
} from "../../sample/mobile";
import { WORKTREE_PATH } from "../../sample/worktree";

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "A red badge on Sessions shows that a session needs you.",
  "Tap the session in Needs you to open it.",
  "Read the approval request. Then tap Approve once.",
  "The agent runs the command and continues its work.",
  "Go back. The session is in Running now.",
] as const;

/** The sessions of the last frame: the Builder runs again after the reply. */
export const LAST_SESSIONS: readonly NavEntry[] = PHONE_SESSIONS.map((entry) =>
  entry.id === WAITING_BUILD ? { ...entry, attention: undefined, unread: false } : entry,
);

/** The request of the Builder. */
export const REQUEST: PermissionRequest = {
  title: "Bash approval requested",
  mutation: "Effect unknown",
  summary: "Codex wants to run a shell command.",
  command: "bun test src/search",
  workingDirectory: WORKTREE_PATH,
  action: "Bash",
  replies: [
    { outcome: "approve_once", label: "Approve once", variant: "default" },
    { outcome: "approve_session", label: "Approve for session", variant: "outline" },
    { outcome: "reject", label: "Reject", variant: "destructive" },
  ],
};

/** The tool calls of the turn, in order. */
export const TOOLS = {
  guide: BUILDER_TOOLS.guide,
  status: codexCommand("bash", "git status --short", "40ms", "9:46:36 AM"),
  keymap: BUILDER_TOOLS.keymap,
  search: BUILDER_TOOLS.search,
  app: codexCommand("list", "ls src/app", "14ms", "9:46:44 AM"),
  shell: BUILDER_TOOLS.shell,
  dialog: BUILDER_TOOLS.dialog,
  dialogTest: codexCommand(
    "read",
    "sed -n '1,160p' src/search/search-dialog.test.tsx",
    "20ms",
    "9:46:47 AM",
  ),
  read: codexCommand("read", "cat src/search/use-search-shortcut.ts", "17ms", "9:48:12 AM"),
  list: { ...BUILDER_TOOLS.list, time: "9:48:14 AM" },
  lint: BUILDER_TOOLS.lint,
  test: BUILDER_TOOLS.test,
  typecheck: BUILDER_TOOLS.typecheck,
} as const satisfies Record<string, MobileCall>;

/**
 * The tool runs of the turn: consecutive calls make one run. The runs that another row follows
 * are folded.
 */
export const RUNS = {
  lookups: ["guide", "status", "keymap", "search", "app", "shell", "dialog", "dialogTest"],
  checks: ["read", "list", "lint"],
  tests: ["test"],
  types: ["typecheck"],
} as const satisfies Record<string, readonly (keyof typeof TOOLS)[]>;

/** The reply of the Builder before the request. */
export const READY =
  "The hook, the app shell, and the search dialog are ready. I run the search tests next.";

/** The reply of the Builder after the tests. */
export const PASSED = "`bun test src/search`: 5 tests pass. I check the types next.";

/** The workflow rail while the Builder waits, and after the reply. */
export const RAIL = {
  waiting: { ...BUILDER_RAIL, build: { tone: "waiting_input", mark: "waiting" } },
  working: BUILDER_RAIL,
} as const satisfies Record<string, Record<RoleId, RailStep>>;
