// The sample data of the Comment on a diff scene of the mobile app. The Builder of the search
// shortcut task committed the hook and ended its turn. The menu title joins the role, the runtime,
// and the model, as sessionHeaderText of session-header-text.ts does. The actions come from
// session-header.tsx, work-view-links.ts, and changes-rows.tsx. The message that Send builds
// follows formatBatchMessage of inline-comment-draft-store.ts in packages/frontend-core. The
// times are fictional.
import {
  CircleCheck,
  ClipboardList,
  Copy,
  Eye,
  FileDiff,
  Files,
  Folder,
  Maximize2,
  Terminal,
} from "lucide-react";
import type { MenuAction } from "../../replicas/mobile/ActionMenu";
import type { ChangesRow } from "../../replicas/mobile/ChangesScreen";
import { commentRangeLabel } from "../../replicas/mobile/diff-comment-text";
import type { RailStep } from "../../replicas/mobile/MobileRail";
import type { MobileTool } from "../../replicas/mobile/TranscriptRows";
import type { RoleId } from "../../replicas/vocabulary";
import { BUILDER_RAIL, BUILDER_TOOLS } from "../../sample/mobile";
import { modelPath } from "../../sample/models";
import { BUILD_FILES, BUILDER_SESSION, HOOK_LINES, HOOK_PATH } from "../../sample/studio";
import { TASK_BRANCH } from "../../sample/worktree";

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "Open the session menu and tap Changes.",
  "In Branch changes, tap a file. Then open its menu and tap Open full diff.",
  "Tap a line, then tap the last line of the range. Tap Comment.",
  "Write the comment and save it. It shows Pending.",
  "Go back and tap Send. The session opens.",
  "Send a message. The comment goes with it.",
] as const;

/** The title of the session menu: the role, the runtime, and the model with its effort. */
export const MENU_TITLE = `Builder · Codex · ${modelPath(BUILDER_SESSION)} · ${BUILDER_SESSION.effort}`;

/** The session menu of a task session. */
export const SESSION_ACTIONS: readonly MenuAction[] = [
  { id: "task-details", title: "Task Details", icon: ClipboardList },
  { id: "copy-task-id", title: "Copy Task ID", icon: Copy },
  { id: "changes", title: "Changes", icon: FileDiff },
  { id: "files", title: "Files", icon: Folder },
  { id: "artifacts", title: "Artifacts", icon: Files },
  { id: "checks", title: "CI Checks", icon: CircleCheck },
  { id: "terminals", title: "Terminals", icon: Terminal },
];

/** The menu of a changed file that is not deleted. */
export const FILE_ACTIONS: readonly MenuAction[] = [
  { id: "open-diff", title: "Open full diff", icon: Maximize2 },
  { id: "view-file", title: "View file", icon: Eye },
  { id: "copy-path", title: "Copy path", icon: Copy },
];

/** The task branch, shortened in the middle as the branch card shows it on the phone. */
export const BRANCH = `${TASK_BRANCH.slice(0, 11)}…${TASK_BRANCH.slice(-10)}`;

/** The file that the visitor comments on. */
export const HOOK = { id: "hook", path: HOOK_PATH, lines: HOOK_LINES } as const;

const fileOf = (path: string) => {
  const file = BUILD_FILES.find((item) => item.path === path);
  if (!file) throw new Error(`The sample change has no file ${path}.`);
  return file;
};

const fileRow = (id: string, path: string): ChangesRow => {
  const file = fileOf(path);
  return {
    kind: "file",
    id,
    name: path.slice(path.lastIndexOf("/") + 1),
    change: file.type === "added" ? "added" : "modified",
    depth: 2,
    add: file.add,
    del: file.del,
  };
};

const filesIn = (folder: string) => BUILD_FILES.filter((file) => file.path.startsWith(folder));
const folderRow = (name: string, folder: string, depth: number): ChangesRow => {
  const files = filesIn(folder);
  return {
    kind: "directory",
    name,
    depth,
    files: files.length,
    add: files.reduce((sum, file) => sum + file.add, 0),
    del: files.reduce((sum, file) => sum + file.del, 0),
  };
};

/** Branch changes as a tree: folders first, then files, each sorted by name. */
export const ROWS: readonly ChangesRow[] = [
  folderRow("src", "src/", 0),
  folderRow("app", "src/app/", 1),
  fileRow("shell", "src/app/app-shell.tsx"),
  folderRow("search", "src/search/", 1),
  fileRow("dialog", "src/search/search-dialog.tsx"),
  fileRow("test", "src/search/use-search-shortcut.test.ts"),
  fileRow(HOOK.id, HOOK_PATH),
];

/** The lines that the visitor selects, and the comment. */
export const RANGE = { first: 9, last: 10 } as const;
export const COMMENT_TEXT = "Use the platform key name from keymap.ts here.";
export const COMMENT = {
  afterLine: RANGE.last,
  range: commentRangeLabel(RANGE.first, RANGE.last),
  text: COMMENT_TEXT,
};

/** The message that the visitor types in the session. */
export const TYPED = "Please fix this before QA.";

/** The message that Send builds: the typed text, then the pending comment. */
export const SENT_MESSAGE = [
  TYPED,
  "## Git Diff Comments",
  [
    "### Comment 1",
    `File: \`${HOOK_PATH}\``,
    "Diff: branch changes",
    "Change: added",
    `Lines: ${RANGE.first}-${RANGE.last}`,
    "Context:",
    "```typescript",
    ...[RANGE.first, RANGE.last].map((line) => `${line} | ${HOOK_LINES[line - 1] ?? ""}`),
    "```",
    `Instruction: ${COMMENT_TEXT}`,
  ].join("\n"),
].join("\n\n");

/** The time of the sent message. */
export const SENT_TIME = "9:52:18 AM";

/** The tool calls of the session, in order. */
export const TOOLS = {
  guide: BUILDER_TOOLS.guide,
  keymapRead: BUILDER_TOOLS.keymap,
  list: BUILDER_TOOLS.list,
  shell: BUILDER_TOOLS.shell,
  lint: BUILDER_TOOLS.lint,
  test: BUILDER_TOOLS.test,
  typecheck: BUILDER_TOOLS.typecheck,
  commit: {
    type: "bash",
    name: "bash",
    summary: 'git commit -m "feat(search): open search with Cmd+K"',
    duration: "180ms",
    time: "9:49:20 AM",
  },
  keymap: { ...BUILDER_TOOLS.keymap, time: "9:52:21 AM" },
} as const satisfies Record<string, MobileTool>;

/** The last reply of the Builder before the scene starts. */
export const DONE =
  "`bun test src/search`: 5 tests pass. I committed the hook, the app shell, and the search dialog.";

/** The reply of the Builder to the comment. */
export const ANSWER =
  "`keymap.ts` exports `platformModifier`. I use it for the check on lines 9 and 10.";

/** The workflow rail while the Builder waits for a message, and while it works. */
export const RAIL = {
  idle: { ...BUILDER_RAIL, build: { tone: "in_progress", mark: "paused" } },
  working: BUILDER_RAIL,
} as const satisfies Record<string, Record<RoleId, RailStep>>;
