import { z } from "zod";

export const SHORTCUT_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type ShortcutPosition = (typeof SHORTCUT_POSITIONS)[number];
export type PositionShortcutActionId =
  | `session-position-${ShortcutPosition}`
  | `workspace-position-${ShortcutPosition}`;

const positionActionIds = (family: "session" | "workspace") =>
  SHORTCUT_POSITIONS.map((position) => `${family}-position-${position}` as const);

/** Stable app actions. Labels and behavior live in the frontend catalogue. */
export const BUILTIN_SHORTCUT_ACTION_IDS = [
  "palette",
  "settings",
  "sidebar",
  "diagnostics",
  "processes",
  "feature-tour",
  "open-repository",
  "reopen-workspace",
  "theme:light",
  "theme:dark",
  "theme:system",
  "task-cards:normal",
  "task-cards:compact",
  "settings:general",
  "settings:keyboard-shortcuts",
  "settings:appearance",
  "settings:remote-access",
  "settings:git",
  "settings:runtimes",
  "settings:repositories",
  "settings:prompts",
  "settings:reusable-prompts",
  "settings:custom-agent-roles",
  "settings:chat",
  "settings:notifications",
  "settings:kanban",
  "settings:autopilot",
  "new-task",
  "new-chat",
  "kanban",
  "import-tasks",
  "import-chat",
  "archived-chats",
  "refresh-tasks",
  "sync-pull-requests",
  "check-merged-tasks",
  "close-workspace",
  "remove-workspace",
  "session-previous",
  "session-next",
  "workspace-previous",
  "workspace-next",
  "usage",
  "workflows",
  "focus-task-search",
  "focus-composer",
  "bottom-panel",
  "right-panel",
  "new-bottom-tab",
  "new-right-tab",
  "close-panel-tab",
  "move-panel-tab",
  "panel:document",
  "panel:diffs",
  "panel:files",
  "panel:ci_checks",
  "panel:terminal",
  "panel:browser",
  "task-edit",
  "task-details",
  "task-copy-id",
  "task-latest-session",
  "task-close",
  "task-reset",
  "task-delete",
  "task-remove-worktree",
  "task-detect-pr",
  "task-unlink-pr",
  "chat-open",
  "chat-rename",
  "chat-archive",
  "chat-restore",
  "chat-read",
  "chat-unread",
  "chat-copy-id",
  "chat-copy-path",
  "session-send",
  "session-stop",
  "session-resume-queue",
  "session-model",
  "session-attach",
  "session-scripts",
  "git-refresh",
  "git-pull",
  "git-push",
  "git-rebase",
  "git-detect-pr",
  "git-commit-staged",
  "git-commit-all",
  "git-stage",
  "git-unstage",
  "git-discard",
  "git-copy-path",
  "git-open-file",
  "git-open-diff",
  "browser-back",
  "browser-forward",
  "browser-reload",
  "browser-stop",
  "browser-address",
  "browser-external",
  "browser-devtools",
  "browser-share",
  "browser-picker",
  "download-reveal",
  "browser-downloads",
  "browser-permissions",
  "content-copy",
  "content-download",
  "content-open",
  "message-copy",
  "message-edit",
  "message-remove",
  "message-steer",
  "message-fork",
  "artifact-add",
  "artifact-edit",
  "artifact-rename",
  "artifact-replace",
  "artifact-delete",
  "content-external",
  "terminal-restart",
  "file-copy-path",
  "file-save",
  ...positionActionIds("session"),
  ...positionActionIds("workspace"),
] as const;

export type BuiltinShortcutActionId = (typeof BUILTIN_SHORTCUT_ACTION_IDS)[number];
export const builtinShortcutActionIdSchema = z.enum(BUILTIN_SHORTCUT_ACTION_IDS);

/** Each part is URI-encoded, so a colon inside an ID cannot change where the parts split. */
export const workflowShortcutActionId = (workflowId: string, actionId: string) =>
  `workflow:${encodeURIComponent(workflowId)}:${encodeURIComponent(actionId)}` as const;

/** The workflow and action of a canonical workflow shortcut ID, or null for any other value. */
export const parseWorkflowShortcutActionId = (
  value: string,
): { workflowId: string; actionId: string } | null => {
  if (!value.startsWith("workflow:")) return null;
  const parts = value.slice("workflow:".length).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const workflowId = decodeURIComponent(parts[0]);
    const actionId = decodeURIComponent(parts[1]);
    return workflowShortcutActionId(workflowId, actionId) === value
      ? { workflowId, actionId }
      : null;
  } catch {
    // SAFETY: decodeURIComponent throws only for malformed escapes, which no canonical ID has.
    return null;
  }
};

export const workflowShortcutActionIdSchema = z
  .templateLiteral(["workflow:", z.string().min(1), ":", z.string().min(1)])
  .refine(
    (value) => parseWorkflowShortcutActionId(value) !== null,
    "Use a canonical workflow action ID.",
  );
export type WorkflowShortcutActionId = z.infer<typeof workflowShortcutActionIdSchema>;
export const shortcutActionIdSchema = z.union([
  builtinShortcutActionIdSchema,
  workflowShortcutActionIdSchema,
]);
export type ShortcutActionId = z.infer<typeof shortcutActionIdSchema>;
