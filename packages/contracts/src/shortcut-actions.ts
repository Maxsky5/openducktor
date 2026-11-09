import { z } from "zod";

/** Stable app actions. Workflow actions come from the connected host catalogue. */
export const BUILTIN_SHORTCUT_ACTIONS = {
  palette: ["Toggle command palette", "App", "app", true],
  settings: ["Open Settings", "App", "app", true],
  sidebar: ["Toggle sidebar", "App", "app", true],
  diagnostics: ["Open diagnostics", "App", "app", false],
  "feature-tour": ["Show tour", "App", "app", false],
  "open-repository": ["Open repository", "App", "app", false],
  "reopen-workspace": ["Reopen a workspace", "App", "app", false],
  "theme:light": ["Theme: Light", "App", "app", false],
  "theme:dark": ["Theme: Dark", "App", "app", false],
  "theme:system": ["Theme: System", "App", "app", false],
  "task-cards:normal": ["Task cards: Normal", "App", "app", false],
  "task-cards:compact": ["Task cards: Compact", "App", "app", false],
  "settings:general": ["Settings: General", "Settings", "app", false],
  "settings:keyboard-shortcuts": ["Keyboard shortcuts", "Settings", "app", false],
  "settings:appearance": ["Settings: Appearance", "Settings", "app", false],
  "settings:remote-access": ["Settings: Remote control", "Settings", "app", false],
  "settings:git": ["Settings: Git", "Settings", "app", false],
  "settings:runtimes": ["Settings: Agent runtimes", "Settings", "app", false],
  "settings:repositories": ["Settings: Repositories", "Settings", "app", false],
  "settings:prompts": ["Settings: System prompts", "Settings", "app", false],
  "settings:reusable-prompts": ["Settings: Reusable prompts", "Settings", "app", false],
  "settings:custom-agent-roles": ["Settings: Custom agent roles", "Settings", "app", false],
  "settings:chat": ["Settings: Sessions", "Settings", "app", false],
  "settings:notifications": ["Settings: Notifications", "Settings", "app", false],
  "settings:kanban": ["Settings: Kanban", "Settings", "app", false],
  "settings:autopilot": ["Settings: Autopilot", "Settings", "app", false],
  "new-task": ["New task", "Workspace", "workspace", true],
  "new-chat": ["New session", "Workspace", "workspace", true],
  kanban: ["Go to Kanban", "Workspace", "workspace", true],
  "import-tasks": ["Import tasks", "Workspace", "workspace", false],
  "import-chat": ["Import session from an external runtime", "Workspace", "workspace", false],
  "archived-chats": ["Archived sessions", "Workspace", "workspace", false],
  "refresh-tasks": ["Refresh tasks", "Workspace", "workspace", false],
  "sync-pull-requests": ["Sync pull requests", "Workspace", "workspace", false],
  "check-merged-tasks": ["Check merged tasks", "Workspace", "workspace", false],
  "close-workspace": ["Close workspace", "Workspace", "workspace", false],
  "remove-workspace": ["Remove workspace", "Workspace", "workspace", false],
  "session-position-1": ["Select session at position 1", "Navigation", "workspace", true],
  "session-position-2": ["Select session at position 2", "Navigation", "workspace", true],
  "session-position-3": ["Select session at position 3", "Navigation", "workspace", true],
  "session-position-4": ["Select session at position 4", "Navigation", "workspace", true],
  "session-position-5": ["Select session at position 5", "Navigation", "workspace", true],
  "session-position-6": ["Select session at position 6", "Navigation", "workspace", true],
  "session-position-7": ["Select session at position 7", "Navigation", "workspace", true],
  "session-position-8": ["Select session at position 8", "Navigation", "workspace", true],
  "session-position-9": ["Select session at position 9", "Navigation", "workspace", true],
  "session-position-10": ["Select session at position 10", "Navigation", "workspace", true],
  "workspace-position-1": ["Select workspace at position 1", "Navigation", "app", true],
  "workspace-position-2": ["Select workspace at position 2", "Navigation", "app", true],
  "workspace-position-3": ["Select workspace at position 3", "Navigation", "app", true],
  "workspace-position-4": ["Select workspace at position 4", "Navigation", "app", true],
  "workspace-position-5": ["Select workspace at position 5", "Navigation", "app", true],
  "workspace-position-6": ["Select workspace at position 6", "Navigation", "app", true],
  "workspace-position-7": ["Select workspace at position 7", "Navigation", "app", true],
  "workspace-position-8": ["Select workspace at position 8", "Navigation", "app", true],
  "workspace-position-9": ["Select workspace at position 9", "Navigation", "app", true],
  "workspace-position-10": ["Select workspace at position 10", "Navigation", "app", true],
  "session-previous": ["Previous session", "Navigation", "app", true],
  "session-next": ["Next session", "Navigation", "app", true],
  "workspace-previous": ["Previous workspace", "Navigation", "app", true],
  "workspace-next": ["Next workspace", "Navigation", "app", true],
  "focus-task-search": ["Focus task search", "Navigation", "app", true],
  "focus-composer": ["Focus composer", "Session", "session", true],
  "bottom-panel": ["Toggle bottom panel", "Session", "session", true],
  "right-panel": ["Toggle right panel", "Session", "session", true],
  "new-bottom-tab": ["New tab in bottom panel", "Session", "session", true],
  "new-right-tab": ["New tab in right panel", "Session", "session", true],
  "close-panel-tab": ["Close current panel tab", "Panels", "panel", true],
  "move-panel-tab": ["Move tab to other panel", "Panels", "panel", false],
  "panel:document": ["Open Artifacts", "Panels", "panel", false],
  "panel:diffs": ["Open Diffs", "Panels", "panel", false],
  "panel:files": ["Open Files", "Panels", "panel", false],
  "panel:ci_checks": ["Open CI Checks", "Panels", "panel", false],
  "panel:terminal": ["Open Terminal", "Panels", "panel", false],
  "panel:browser": ["Open Browser", "Panels", "panel", false],
  "task-edit": ["Edit task", "Task", "task", false],
  "task-details": ["Task details", "Task", "task", false],
  "task-copy-id": ["Copy task ID", "Task", "task", false],
  "task-latest-session": ["Open latest session", "Task", "task", false],
  "task-close": ["Close Task", "Task", "task", false],
  "task-reset": ["Reset Task", "Task", "task", false],
  "task-delete": ["Delete task", "Task", "task", false],
  "task-remove-worktree": ["Remove Worktree", "Task", "task", false],
  "task-detect-pr": ["Detect pull request", "Task", "task", false],
  "task-unlink-pr": ["Unlink pull request", "Task", "task", false],
  "chat-open": ["Open chat", "Chat", "chat", false],
  "chat-rename": ["Rename chat", "Chat", "chat", false],
  "chat-archive": ["Archive chat", "Chat", "chat", false],
  "chat-restore": ["Restore chat", "Chat", "chat", false],
  "chat-read": ["Mark read", "Chat", "chat", false],
  "chat-unread": ["Mark unread", "Chat", "chat", false],
  "chat-copy-id": ["Copy chat ID", "Chat", "chat", false],
  "chat-copy-path": ["Copy worktree path", "Chat", "chat", false],
  "session-send": ["Send message", "Session", "session", false],
  "session-stop": ["Stop run", "Session", "session", false],
  "session-resume-queue": ["Resume queue", "Session", "session", false],
  "session-model": ["Choose model", "Session", "session", false],
  "session-attach": ["Attach files", "Session", "session", false],
  "session-scripts": ["Choose repository action", "Session", "session", false],
  "git-refresh": ["Refresh Git", "Git", "item", false],
  "git-pull": ["Pull", "Git", "item", false],
  "git-push": ["Push", "Git", "item", false],
  "git-rebase": ["Rebase", "Git", "item", false],
  "git-detect-pr": ["Detect PR", "Git", "item", false],
  "git-commit-staged": ["Commit staged changes", "Git", "item", false],
  "git-commit-all": ["Commit all changes", "Git", "item", false],
  "git-stage": ["Stage changes", "Git", "item", false],
  "git-unstage": ["Unstage changes", "Git", "item", false],
  "git-discard": ["Discard changes", "Git", "item", false],
  "git-copy-path": ["Copy file path", "Git", "item", false],
  "git-open-file": ["Open file", "Git", "item", false],
  "git-open-diff": ["Open diff", "Git", "item", false],
  "browser-back": ["Browser back", "Browser", "item", false],
  "browser-forward": ["Browser forward", "Browser", "item", false],
  "browser-reload": ["Reload page", "Browser", "item", false],
  "browser-stop": ["Stop loading", "Browser", "item", false],
  "browser-address": ["Focus address", "Browser", "item", false],
  "browser-external": ["Open in external browser", "Browser", "item", false],
  "browser-devtools": ["Open developer tools", "Browser", "item", false],
  "browser-share": ["Share browser tab", "Browser", "item", false],
  "browser-picker": ["Select page element", "Browser", "item", false],
  "download-reveal": ["Show download in folder", "Browser", "item", false],
  "browser-downloads": ["Show downloads", "Browser", "item", false],
  "browser-permissions": ["Site permissions", "Browser", "item", false],
  "content-copy": ["Copy content", "Content", "item", false],
  "content-download": ["Download", "Content", "item", false],
  "content-open": ["Open content", "Content", "item", false],
  "message-copy": ["Copy message", "Content", "item", false],
  "message-edit": ["Edit queued message", "Content", "item", false],
  "message-remove": ["Remove queued message", "Content", "item", false],
  "message-steer": ["Steer queued message", "Content", "item", false],
  "message-fork": ["Fork from message", "Content", "item", false],
  "artifact-add": ["Add artifact", "Content", "item", false],
  "artifact-edit": ["Edit artifact", "Content", "item", false],
  "artifact-rename": ["Rename artifact", "Content", "item", false],
  "artifact-replace": ["Replace artifact content", "Content", "item", false],
  "artifact-delete": ["Delete artifact", "Content", "item", false],
  "content-external": ["Choose external application", "Content", "item", false],
  "terminal-restart": ["Restart command", "Content", "item", false],
  "file-copy-path": ["Copy working directory", "Content", "item", false],
  "file-save": ["Save file", "Content", "item", true],
} as const;

export type BuiltinShortcutActionId = keyof typeof BUILTIN_SHORTCUT_ACTIONS;
export const builtinShortcutActionIdSchema = z.enum(
  // SAFETY: Object.keys returns only the own keys of the literal catalogue above.
  Object.keys(BUILTIN_SHORTCUT_ACTIONS) as BuiltinShortcutActionId[],
);
export const workflowShortcutActionId = (workflowId: string, actionId: string) =>
  /[:%]/.test(workflowId + actionId)
    ? (`workflow-action:${encodeURIComponent(workflowId)}:${encodeURIComponent(actionId)}` as const)
    : (`workflow:${workflowId}:${actionId}` as const);

const legacyWorkflowActionIdSchema = z.templateLiteral([
  "workflow:",
  z.string().min(1),
  ":",
  z.string().min(1),
]);
const escapedWorkflowActionIdSchema = z
  .templateLiteral(["workflow-action:", z.string().min(1), ":", z.string().min(1)])
  .refine((value) => {
    const parts = value.slice("workflow-action:".length).split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    try {
      return (
        workflowShortcutActionId(decodeURIComponent(parts[0]), decodeURIComponent(parts[1])) ===
        value
      );
    } catch {
      return false;
    }
  }, "Use a canonical qualified workflow action ID.");
export const workflowShortcutActionIdSchema = z.union([
  legacyWorkflowActionIdSchema,
  escapedWorkflowActionIdSchema,
]);
export type WorkflowShortcutActionId = z.infer<typeof workflowShortcutActionIdSchema>;
export const shortcutActionIdSchema = z.union([
  builtinShortcutActionIdSchema,
  workflowShortcutActionIdSchema,
]);
export type ShortcutActionId = z.infer<typeof shortcutActionIdSchema>;

export const SHORTCUT_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
