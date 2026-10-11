// The rows of the command palette in the palette view. The tasks of the other workspaces and the
// chats are fictional. Sources: command-palette-groups.ts for the groups,
// use-command-palette-actions.tsx for the actions, and command-palette-task-model.tsx for the task
// actions.
import type { Attention } from "../replica/shell/nav";
import type { DotState, LaneId, RoleId, TaskKind } from "../replica/vocabulary";
import { TASKS } from "./tasks";
import { taskId, type WorkspaceName } from "./workspace";

/** The footer hints of a highlighted row: Enter, then Mod+Enter, Mod+E, and Tab. */
export type RowHints = { enter: string; next?: string; edit?: "Edit" | "Rename"; tab?: boolean };

export type PaletteTask = {
  kind: "task";
  id: string;
  title: string;
  taskId: string;
  workspace: WorkspaceName;
  issue: TaskKind;
  status: LaneId;
  dot?: DotState;
  attention?: Attention;
  hints: RowHints;
};

export type PaletteChat = {
  kind: "chat";
  id: string;
  title: string;
  workspace: WorkspaceName;
  dot: DotState;
  hints: RowHints;
};

/** The lucide icons of the app actions and the task actions. */
export type PaletteIcon =
  | "plus"
  | "message-circle-plus"
  | "download"
  | "import"
  | "columns-3"
  | "settings"
  | "folder-git-2"
  | "message-square-text"
  | "archive"
  | "refresh-ccw"
  | "history"
  | "pencil"
  | "panel-right-open"
  | "copy"
  | "rotate-ccw"
  | "trash-2"
  | "reply";

/**
 * An action row. It shows a lucide icon, or the icon of its role when it starts or opens a
 * session.
 */
export type PaletteAction = {
  kind: "action";
  id: string;
  label: string;
  /** The workspace of a workspace action, as "in fieldnotes". */
  scope?: string;
  /** A muted detail after the label, such as the role of the latest session. */
  detail?: string;
  destructive?: boolean;
} & ({ icon: PaletteIcon; role?: never } | { role: RoleId; icon?: never });

export type PaletteRow = PaletteTask | PaletteChat | PaletteAction;

const fieldnotes = "fieldnotes";
const inFieldnotes = { scope: fieldnotes };
const open = { enter: "Open details", edit: "Edit", tab: true } as const;

/** The task that waits for your answer: its Builder asks a question. */
export const WAITING_TASK: PaletteTask = {
  kind: "task",
  id: "empty",
  title: TASKS.p6d4.title,
  taskId: taskId("p6d4"),
  workspace: fieldnotes,
  issue: TASKS.p6d4.kind,
  status: "in_progress",
  dot: "input",
  attention: "Question",
  hints: { enter: "Open Builder session", next: "Open Builder", edit: "Edit", tab: true },
};

/** The actions that the palette suggests before you type. */
export const SUGGESTED: readonly PaletteAction[] = [
  { kind: "action", id: "new-task", label: "New task", icon: "plus", ...inFieldnotes },
  {
    kind: "action",
    id: "new-chat",
    label: "New chat",
    icon: "message-circle-plus",
    ...inFieldnotes,
  },
  {
    kind: "action",
    id: "import-issues",
    label: "Import tasks from GitHub Issues",
    icon: "download",
    ...inFieldnotes,
  },
  {
    kind: "action",
    id: "import-chat",
    label: "Import chat from an external runtime",
    icon: "import",
    ...inFieldnotes,
  },
  { kind: "action", id: "kanban", label: "Go to Kanban", icon: "columns-3", ...inFieldnotes },
  { kind: "action", id: "settings", label: "Open settings", icon: "settings" },
];

/** The query that the visitor types: the letters of "search", with a gap. */
export const QUERY = "srch";

/** The task that the scene starts, and the tasks and chats that the search can find. */
export const SEARCH_TARGET = "titles";
export const SEARCH_ROWS: readonly PaletteRow[] = [
  {
    kind: "task",
    id: "shortcut",
    title: TASKS.k3x9.title,
    taskId: taskId("k3x9"),
    workspace: fieldnotes,
    issue: TASKS.k3x9.kind,
    status: "in_progress",
    dot: "running",
    hints: { enter: "Open Builder session", next: "Open Builder", edit: "Edit", tab: true },
  },
  {
    kind: "task",
    id: SEARCH_TARGET,
    title: TASKS.h5w3.title,
    taskId: taskId("h5w3"),
    workspace: fieldnotes,
    issue: TASKS.h5w3.kind,
    status: "spec_ready",
    dot: "read",
    hints: { enter: "Open Spec session", next: "Start Planner", edit: "Edit", tab: true },
  },
  {
    kind: "task",
    id: "focus",
    title: TASKS.r9c2.title,
    taskId: taskId("r9c2"),
    workspace: fieldnotes,
    issue: TASKS.r9c2.kind,
    status: "ai_review",
    dot: "running",
    hints: { enter: "Open QA session", edit: "Edit", tab: true },
  },
  {
    kind: "task",
    id: "paginate",
    title: "Paginate the search endpoint",
    taskId: taskId("x7p2", "fable-api"),
    workspace: "fable-api",
    issue: "feature",
    status: "open",
    hints: { ...open, next: "Start Spec" },
  },
  {
    kind: "task",
    id: "ring",
    title: "Add a focus ring to the search field",
    taskId: taskId("k4d1", "design-system"),
    workspace: "design-system",
    issue: "task",
    status: "in_progress",
    dot: "read",
    hints: { enter: "Open Builder session", next: "Open Builder", edit: "Edit", tab: true },
  },
  {
    kind: "task",
    id: "sync",
    title: TASKS.b8t1.title,
    taskId: taskId("b8t1"),
    workspace: fieldnotes,
    issue: TASKS.b8t1.kind,
    status: "in_progress",
    dot: "running",
    hints: { enter: "Open Builder session", next: "Open Builder", edit: "Edit", tab: true },
  },
  {
    kind: "chat",
    id: "accents",
    title: "Why does search miss accented words?",
    workspace: fieldnotes,
    dot: "read",
    hints: { enter: "Open chat", edit: "Rename", tab: true },
  },
  {
    kind: "chat",
    id: "export",
    title: "Plan the export feature",
    workspace: fieldnotes,
    dot: "read",
    hints: { enter: "Open chat", edit: "Rename", tab: true },
  },
  { kind: "action", id: "settings-repos", label: "Settings: Repositories", icon: "folder-git-2" },
  {
    kind: "action",
    id: "settings-prompts",
    label: "Settings: System Prompts",
    icon: "message-square-text",
  },
  { kind: "action", id: "archived", label: "Archived chats", icon: "archive", ...inFieldnotes },
  { kind: "action", id: "refresh", label: "Refresh tasks", icon: "refresh-ccw", ...inFieldnotes },
];

/** The task actions of the searched task, in the order of command-palette-task-model.tsx. */
export const TARGET_ACTIONS: readonly PaletteAction[] = [
  { kind: "action", id: "latest", label: "Open latest session", icon: "history", detail: "Spec" },
  { kind: "action", id: "session-spec", label: "Open Spec session", role: "spec" },
  { kind: "action", id: "start-planner", label: "Start Planner", role: "planner" },
  { kind: "action", id: "edit", label: "Edit task", icon: "pencil" },
  { kind: "action", id: "details", label: "Open task details", icon: "panel-right-open" },
  { kind: "action", id: "copy", label: "Copy task ID", icon: "copy" },
  { kind: "action", id: "reset", label: "Reset Task", icon: "rotate-ccw", destructive: true },
  { kind: "action", id: "delete", label: "Delete task", icon: "trash-2", destructive: true },
];

/**
 * The task actions of the waiting task. The reply comes first. A task with a live session lists
 * no action that starts another session.
 */
export const WAITING_ACTIONS: readonly PaletteAction[] = [
  { kind: "action", id: "reply", label: "Reply to question", icon: "reply" },
  {
    kind: "action",
    id: "latest",
    label: "Open latest session",
    icon: "history",
    detail: "Builder",
  },
  { kind: "action", id: "session-build", label: "Open Builder session", role: "build" },
  { kind: "action", id: "edit", label: "Edit task", icon: "pencil" },
  { kind: "action", id: "details", label: "Open task details", icon: "panel-right-open" },
  { kind: "action", id: "copy", label: "Copy task ID", icon: "copy" },
];
