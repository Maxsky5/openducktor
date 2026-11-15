import {
  type AppPlatform,
  BUILTIN_SHORTCUT_ACTION_IDS,
  type BuiltinShortcutActionId,
  isShortcutKey,
  resolveShortcutModifiers,
  sameShortcut,
  SHORTCUT_DIGITS,
  SHORTCUT_POSITIONS,
  type ShortcutActionId,
  type ShortcutCombination,
  type ShortcutPosition,
  type ShortcutPreferences,
  type ShortcutWhen,
  shortcutSignature,
} from "@openducktor/contracts";
import { shortcutLabel } from "@openducktor/frontend-core/shortcuts/key-labels";
import { resolveTerminalKeyAction } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";

export type ShortcutShell = "electron" | "browser";
export type FocusArea = "panel" | "git" | "browser" | "content";

/**
 * Where a command runs. `app` commands run anywhere in the app; `needs` names the view that must
 * exist. `focus` commands run only with focus inside their owner. `record` commands target the
 * highlighted palette row or the visible task or chat. `workflow` commands target a task of that
 * workflow.
 */
export type ShortcutScope =
  | { kind: "app"; needs?: "workspace" | "session" }
  | { kind: "focus"; area: FocusArea }
  | { kind: "record"; record: "task" | "chat" }
  | { kind: "workflow"; workflowId: string };

type ShortcutCommandSpec = {
  label: string;
  group: string;
  scope: ShortcutScope;
  /**
   * Runs while an editor, a terminal, or a visited page has focus. Its default may replace a
   * protected editing key there, as the specification approves.
   */
  allowInput?: true;
  defaultKeys?: ShortcutCombination | Record<ShortcutShell, ShortcutCombination>;
};

export type ShortcutCommandDefinition = {
  id: ShortcutActionId;
  label: string;
  group: string;
  scope: ShortcutScope;
  /** Runs while an editor, a terminal or a visited page has focus, after the user's `when` choice. */
  allowInput: boolean;
  /** `allowInput` before the user's choice. Only its default keys may replace a protected key. */
  defaultAllowInput: boolean;
  defaultKeys: Record<ShortcutShell, ShortcutCombination | null>;
  unavailableReason?: string;
};

const MOD = { mod: true } as const;
const CTRL = { ctrl: true } as const;
function chord(
  key: string,
  modifiers: Partial<Omit<ShortcutCombination, "key">>,
): ShortcutCombination {
  return {
    key: { kind: "logical", key },
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    ...modifiers,
  };
}

const APP = { kind: "app" } as const;
const WORKSPACE = { kind: "app", needs: "workspace" } as const;
const SESSION = { kind: "app", needs: "session" } as const;
const TASK = { kind: "record", record: "task" } as const;
const CHAT = { kind: "record", record: "chat" } as const;
const focus = (area: FocusArea) => ({ kind: "focus", area }) as const;

function positionCommands<Family extends "session" | "workspace">(family: Family) {
  // SAFETY: The loop below sets one entry for each of the ten positions.
  const commands = {} as Record<`${Family}-position-${ShortcutPosition}`, ShortcutCommandSpec>;
  for (const position of SHORTCUT_POSITIONS)
    commands[`${family}-position-${position}`] = {
      label: `Select ${family} at position ${position}`,
      group: "Navigation",
      scope: family === "session" ? WORKSPACE : APP,
      allowInput: true,
      defaultKeys: {
        key: { kind: "number-row", digit: SHORTCUT_DIGITS[position % 10]! },
        mod: true,
        ctrl: false,
        alt: false,
        shift: family === "workspace",
      },
    };
  return commands;
}

const BUILTIN_COMMANDS = {
  palette: {
    label: "Toggle command palette",
    group: "App",
    scope: APP,
    allowInput: true,
    defaultKeys: chord("k", MOD),
  },
  settings: {
    label: "Open Settings",
    group: "App",
    scope: APP,
    allowInput: true,
    defaultKeys: chord(",", CTRL),
  },
  sidebar: {
    label: "Toggle sidebar",
    group: "App",
    scope: APP,
    allowInput: true,
    defaultKeys: chord("b", CTRL),
  },
  diagnostics: { label: "Open diagnostics", group: "App", scope: APP },
  "feature-tour": { label: "Show tour", group: "App", scope: APP },
  "open-repository": { label: "Open repository", group: "App", scope: APP },
  "reopen-workspace": { label: "Reopen a workspace", group: "App", scope: APP },
  "theme:light": { label: "Theme: Light", group: "App", scope: APP },
  "theme:dark": { label: "Theme: Dark", group: "App", scope: APP },
  "theme:system": { label: "Theme: System", group: "App", scope: APP },
  "task-cards:normal": { label: "Task cards: Normal", group: "App", scope: APP },
  "task-cards:compact": { label: "Task cards: Compact", group: "App", scope: APP },
  "settings:general": { label: "Settings: General", group: "Settings", scope: APP },
  "settings:keyboard-shortcuts": { label: "Keyboard shortcuts", group: "Settings", scope: APP },
  "settings:appearance": { label: "Settings: Appearance", group: "Settings", scope: APP },
  "settings:remote-access": { label: "Settings: Remote control", group: "Settings", scope: APP },
  "settings:git": { label: "Settings: Git", group: "Settings", scope: APP },
  "settings:runtimes": { label: "Settings: Agent runtimes", group: "Settings", scope: APP },
  "settings:repositories": { label: "Settings: Repositories", group: "Settings", scope: APP },
  "settings:prompts": { label: "Settings: System prompts", group: "Settings", scope: APP },
  "settings:reusable-prompts": {
    label: "Settings: Reusable prompts",
    group: "Settings",
    scope: APP,
  },
  "settings:custom-agent-roles": {
    label: "Settings: Custom agent roles",
    group: "Settings",
    scope: APP,
  },
  "settings:chat": { label: "Settings: Sessions", group: "Settings", scope: APP },
  "settings:notifications": { label: "Settings: Notifications", group: "Settings", scope: APP },
  "settings:kanban": { label: "Settings: Kanban", group: "Settings", scope: APP },
  "settings:autopilot": { label: "Settings: Autopilot", group: "Settings", scope: APP },
  "new-task": {
    label: "New task",
    group: "Workspace",
    scope: WORKSPACE,
    allowInput: true,
    defaultKeys: chord("o", CTRL),
  },
  "new-chat": {
    label: "New session",
    group: "Workspace",
    scope: WORKSPACE,
    allowInput: true,
    defaultKeys: chord("o", { ...CTRL, shift: true }),
  },
  kanban: {
    label: "Go to Kanban",
    group: "Workspace",
    scope: WORKSPACE,
    allowInput: true,
    defaultKeys: chord("g", CTRL),
  },
  "import-tasks": { label: "Import tasks", group: "Workspace", scope: WORKSPACE },
  "import-chat": {
    label: "Import session from an external runtime",
    group: "Workspace",
    scope: WORKSPACE,
  },
  "archived-chats": { label: "Archived sessions", group: "Workspace", scope: WORKSPACE },
  "refresh-tasks": { label: "Refresh tasks", group: "Workspace", scope: WORKSPACE },
  "sync-pull-requests": { label: "Sync pull requests", group: "Workspace", scope: WORKSPACE },
  "check-merged-tasks": { label: "Check merged tasks", group: "Workspace", scope: WORKSPACE },
  "close-workspace": { label: "Close workspace", group: "Workspace", scope: WORKSPACE },
  "remove-workspace": { label: "Remove workspace", group: "Workspace", scope: WORKSPACE },
  "session-previous": {
    label: "Previous session",
    group: "Navigation",
    scope: APP,
    allowInput: true,
  },
  "session-next": { label: "Next session", group: "Navigation", scope: APP, allowInput: true },
  "workspace-previous": {
    label: "Previous workspace",
    group: "Navigation",
    scope: APP,
    allowInput: true,
  },
  "workspace-next": { label: "Next workspace", group: "Navigation", scope: APP, allowInput: true },
  "focus-task-search": {
    label: "Focus task search",
    group: "Navigation",
    scope: APP,
    allowInput: true,
    defaultKeys: chord("f", MOD),
  },
  "focus-composer": {
    label: "Focus composer",
    group: "Session",
    scope: SESSION,
    allowInput: true,
    defaultKeys: chord("i", CTRL),
  },
  "bottom-panel": {
    label: "Toggle bottom panel",
    group: "Session",
    scope: SESSION,
    allowInput: true,
    defaultKeys: chord("j", MOD),
  },
  "right-panel": {
    label: "Toggle right panel",
    group: "Session",
    scope: SESSION,
    allowInput: true,
    defaultKeys: chord("l", MOD),
  },
  "new-bottom-tab": {
    label: "New tab in bottom panel",
    group: "Session",
    scope: SESSION,
    allowInput: true,
    defaultKeys: chord("enter", { ...MOD, shift: true }),
  },
  "new-right-tab": {
    label: "New tab in right panel",
    group: "Session",
    scope: SESSION,
    allowInput: true,
    defaultKeys: chord("enter", { ...MOD, alt: true }),
  },
  "close-panel-tab": {
    label: "Close current panel tab",
    group: "Panels",
    scope: focus("panel"),
    allowInput: true,
    defaultKeys: { electron: chord("w", MOD), browser: chord("x", { ...CTRL, shift: true }) },
  },
  "move-panel-tab": { label: "Move tab to other panel", group: "Panels", scope: focus("panel") },
  "panel:document": { label: "Open Artifacts", group: "Panels", scope: focus("panel") },
  "panel:diffs": { label: "Open Diffs", group: "Panels", scope: focus("panel") },
  "panel:files": { label: "Open Files", group: "Panels", scope: focus("panel") },
  "panel:ci_checks": { label: "Open CI Checks", group: "Panels", scope: focus("panel") },
  "panel:terminal": { label: "Open Terminal", group: "Panels", scope: focus("panel") },
  "panel:browser": { label: "Open Browser", group: "Panels", scope: focus("panel") },
  "task-edit": { label: "Edit task", group: "Task", scope: TASK, defaultKeys: chord("e", MOD) },
  "task-details": { label: "Task details", group: "Task", scope: TASK },
  "task-copy-id": { label: "Copy task ID", group: "Task", scope: TASK },
  "task-latest-session": { label: "Open latest session", group: "Task", scope: TASK },
  "task-close": { label: "Close Task", group: "Task", scope: TASK },
  "task-reset": { label: "Reset Task", group: "Task", scope: TASK },
  "task-delete": { label: "Delete task", group: "Task", scope: TASK },
  "task-remove-worktree": { label: "Remove Worktree", group: "Task", scope: TASK },
  "task-detect-pr": { label: "Detect pull request", group: "Task", scope: TASK },
  "task-unlink-pr": { label: "Unlink pull request", group: "Task", scope: TASK },
  "chat-open": { label: "Open chat", group: "Chat", scope: CHAT },
  "chat-rename": { label: "Rename chat", group: "Chat", scope: CHAT },
  "chat-archive": { label: "Archive chat", group: "Chat", scope: CHAT },
  "chat-restore": { label: "Restore chat", group: "Chat", scope: CHAT },
  "chat-read": { label: "Mark read", group: "Chat", scope: CHAT },
  "chat-unread": { label: "Mark unread", group: "Chat", scope: CHAT },
  "chat-copy-id": { label: "Copy chat ID", group: "Chat", scope: CHAT },
  "chat-copy-path": { label: "Copy worktree path", group: "Chat", scope: CHAT },
  "session-send": { label: "Send message", group: "Session", scope: SESSION },
  "session-stop": { label: "Stop run", group: "Session", scope: SESSION },
  "session-resume-queue": { label: "Resume queue", group: "Session", scope: SESSION },
  "session-model": { label: "Choose model", group: "Session", scope: SESSION },
  "session-attach": { label: "Attach files", group: "Session", scope: SESSION },
  "session-scripts": { label: "Choose repository action", group: "Session", scope: SESSION },
  "git-refresh": { label: "Refresh Git", group: "Git", scope: focus("git") },
  "git-pull": { label: "Pull", group: "Git", scope: focus("git") },
  "git-push": { label: "Push", group: "Git", scope: focus("git") },
  "git-rebase": { label: "Rebase", group: "Git", scope: focus("git") },
  "git-detect-pr": { label: "Detect PR", group: "Git", scope: focus("git") },
  "git-commit-staged": { label: "Commit staged changes", group: "Git", scope: focus("git") },
  "git-commit-all": { label: "Commit all changes", group: "Git", scope: focus("git") },
  "git-stage": { label: "Stage changes", group: "Git", scope: focus("git") },
  "git-unstage": { label: "Unstage changes", group: "Git", scope: focus("git") },
  "git-discard": { label: "Discard changes", group: "Git", scope: focus("git") },
  "git-copy-path": { label: "Copy file path", group: "Git", scope: focus("git") },
  "git-open-file": { label: "Open file", group: "Git", scope: focus("git") },
  "git-open-diff": { label: "Open diff", group: "Git", scope: focus("git") },
  "browser-back": { label: "Browser back", group: "Browser", scope: focus("browser") },
  "browser-forward": { label: "Browser forward", group: "Browser", scope: focus("browser") },
  "browser-reload": { label: "Reload page", group: "Browser", scope: focus("browser") },
  "browser-stop": { label: "Stop loading", group: "Browser", scope: focus("browser") },
  "browser-address": { label: "Focus address", group: "Browser", scope: focus("browser") },
  "browser-external": {
    label: "Open in external browser",
    group: "Browser",
    scope: focus("browser"),
  },
  "browser-devtools": { label: "Open developer tools", group: "Browser", scope: focus("browser") },
  "browser-share": { label: "Share browser tab", group: "Browser", scope: focus("browser") },
  "browser-picker": { label: "Select page element", group: "Browser", scope: focus("browser") },
  "download-reveal": {
    label: "Show download in folder",
    group: "Browser",
    scope: focus("browser"),
  },
  "browser-downloads": { label: "Show downloads", group: "Browser", scope: focus("browser") },
  "browser-permissions": { label: "Site permissions", group: "Browser", scope: focus("browser") },
  "content-copy": { label: "Copy content", group: "Content", scope: focus("content") },
  "content-download": { label: "Download", group: "Content", scope: focus("content") },
  "content-open": { label: "Open content", group: "Content", scope: focus("content") },
  "message-copy": { label: "Copy message", group: "Content", scope: focus("content") },
  "message-edit": { label: "Edit queued message", group: "Content", scope: focus("content") },
  "message-remove": { label: "Remove queued message", group: "Content", scope: focus("content") },
  "message-steer": { label: "Steer queued message", group: "Content", scope: focus("content") },
  "message-fork": { label: "Fork from message", group: "Content", scope: focus("content") },
  "artifact-add": { label: "Add artifact", group: "Content", scope: focus("content") },
  "artifact-edit": { label: "Edit artifact", group: "Content", scope: focus("content") },
  "artifact-rename": { label: "Rename artifact", group: "Content", scope: focus("content") },
  "artifact-replace": {
    label: "Replace artifact content",
    group: "Content",
    scope: focus("content"),
  },
  "artifact-delete": { label: "Delete artifact", group: "Content", scope: focus("content") },
  "content-external": {
    label: "Choose external application",
    group: "Content",
    scope: focus("content"),
  },
  "terminal-restart": { label: "Restart command", group: "Content", scope: focus("content") },
  "file-copy-path": { label: "Copy working directory", group: "Content", scope: focus("content") },
  "file-save": { label: "Save file", group: "Content", scope: focus("content"), allowInput: true },
  ...positionCommands("session"),
  ...positionCommands("workspace"),
} satisfies Record<BuiltinShortcutActionId, ShortcutCommandSpec>;

const toDefinition = (id: BuiltinShortcutActionId): ShortcutCommandDefinition => {
  const spec: ShortcutCommandSpec = BUILTIN_COMMANDS[id];
  const keys = spec.defaultKeys;
  return {
    id,
    label: spec.label,
    group: spec.group,
    scope: spec.scope,
    allowInput: spec.allowInput === true,
    defaultAllowInput: spec.allowInput === true,
    defaultKeys:
      keys === undefined
        ? { electron: null, browser: null }
        : "key" in keys
          ? { electron: keys, browser: keys }
          : keys,
  };
};

export const SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] =
  BUILTIN_SHORTCUT_ACTION_IDS.map(toDefinition);
const commandsById = new Map<ShortcutActionId, ShortcutCommandDefinition>(
  SHORTCUT_COMMANDS.map((command) => [command.id, command]),
);
export const commandDefinition = (id: ShortcutActionId): ShortcutCommandDefinition | undefined =>
  commandsById.get(id);

export const workflowCommandDefinition = (
  id: ShortcutActionId,
  workflowId: string,
  label: string,
  unavailableReason?: string,
): ShortcutCommandDefinition => {
  const definition: ShortcutCommandDefinition = {
    id,
    label,
    group: unavailableReason ? "Unavailable workflows" : "Task workflow",
    scope: { kind: "workflow", workflowId },
    allowInput: false,
    defaultAllowInput: false,
    defaultKeys: { electron: null, browser: null },
  };
  if (unavailableReason) definition.unavailableReason = unavailableReason;
  return definition;
};

export const effectiveShortcut = (
  command: ShortcutCommandDefinition,
  preferences: ShortcutPreferences,
  shell: ShortcutShell,
): ShortcutCombination | null =>
  Object.hasOwn(preferences.overrides, command.id)
    ? (preferences.overrides[command.id] ?? null)
    : command.defaultKeys[shell];

/**
 * Users choose `when` only for app-wide commands; other scopes never run while typing. The palette
 * toggle always runs, so a choice would not change it.
 */
export const canChooseWhen = (command: ShortcutCommandDefinition): boolean =>
  command.scope.kind === "app" && command.id !== "palette";
export const whenOf = (command: ShortcutCommandDefinition): ShortcutWhen =>
  command.allowInput ? "always" : "not-typing";
/** The command with the saved `when` choice applied. */
export const withWhen = (
  command: ShortcutCommandDefinition,
  preferences: ShortcutPreferences,
): ShortcutCommandDefinition => {
  const when = canChooseWhen(command) ? preferences.when?.[command.id] : undefined;
  return when ? { ...command, allowInput: when === "always" } : command;
};

const recordKind = (scope: ShortcutScope) =>
  scope.kind === "record" ? scope.record : scope.kind === "workflow" ? "task" : null;

/** True when both commands can be eligible at once, so they cannot share keys. */
export const scopesCanCoexist = (left: ShortcutScope, right: ShortcutScope): boolean => {
  if (left.kind === "focus" && right.kind === "focus")
    return left.area === right.area || left.area === "panel" || right.area === "panel";
  if (left.kind === "workflow" && right.kind === "workflow")
    return left.workflowId === right.workflowId;
  const leftRecord = recordKind(left);
  const rightRecord = recordKind(right);
  return leftRecord === null || rightRecord === null || leftRecord === rightRecord;
};

/** While the palette is open, only its toggle and the commands of its highlighted row run. */
export const runsInPalette = (command: ShortcutCommandDefinition): boolean =>
  command.id === "palette" || recordKind(command.scope) !== null;

const FOCUS_WHEN = {
  panel: "A panel has focus",
  git: "The Git panel has focus",
  browser: "A browser tab has focus",
  content: "An item has focus",
} as const satisfies Record<FocusArea, string>;

/**
 * When a command runs, for Settings. App-wide commands say only whether they run while typing,
 * because typing is the most common reason that a key does nothing; a workspace or a session that
 * they need is obvious from their name.
 */
export const whenLabel = (entry: ShortcutCommandDefinition): string => {
  const { scope } = entry;
  if (scope.kind === "focus") return FOCUS_WHEN[scope.area];
  const record = recordKind(scope);
  if (record) return record === "chat" ? "A session is selected" : "A task is selected";
  return entry.allowInput ? "Always" : "Not while typing";
};

type DeviceKeys = { key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };

const EDITING_KEYS = ["arrowleft", "arrowright", "arrowup", "arrowdown", "backspace", "delete"];
const CONTROL_EDITING_LETTERS = "abdefghijklmnoptuvwy";

const protectedInputReason = (keys: DeviceKeys, platform: AppPlatform): string | null => {
  const { key, ctrl, meta, alt, shift } = keys;
  const mod = platform === "darwin" ? meta : ctrl;
  if (
    platform === "darwin" &&
    alt &&
    [...EDITING_KEYS, "home", "end", "pageup", "pagedown"].includes(key)
  )
    return "native editing and selection";
  if (mod && ["a", "c", "x", "v", "z", "y", ...EDITING_KEYS, "home", "end"].includes(key))
    return "native editing and selection";
  if (key === "enter" && !alt && !shift) return "message submission";
  const terminalEvent = {
    key,
    type: "keydown",
    ctrlKey: ctrl,
    metaKey: meta,
    altKey: alt,
    shiftKey: shift,
  };
  if (
    (["darwin", "linux", "win32"] as const).some((hostPlatform) =>
      [false, true].some(
        (selection) =>
          resolveTerminalKeyAction(terminalEvent, hostPlatform, selection).type !== "passthrough",
      ),
    )
  )
    return "terminal copy, paste or line editing";
  if (ctrl && !meta && !alt && key.length === 1 && CONTROL_EDITING_LETTERS.includes(key))
    return "Control-key editing";
  return null;
};

const shellReserved = (keys: DeviceKeys, platform: AppPlatform, shell: ShortcutShell): boolean => {
  const { key, ctrl, meta, alt } = keys;
  const mod = platform === "darwin" ? meta : ctrl;
  return (
    (shell === "browser" && mod && ["w", "t", "n"].includes(key)) ||
    (platform === "darwin" && meta && ["tab", " "].includes(key)) ||
    (platform !== "darwin" && alt && key === "tab") ||
    (platform !== "darwin" && ctrl && alt && key === "delete") ||
    (alt && key === "f4") ||
    (mod && key === "q")
  );
};

/** Why an assignment cannot run on a device. `conflict` names the command that keeps the keys. */
export type ShortcutProblem = {
  commandId: ShortcutActionId;
  message: string;
  conflict?: ShortcutCommandDefinition;
};
export type ShortcutBinding = {
  command: ShortcutCommandDefinition;
  combination: ShortcutCombination;
  signature: string;
};
export type CompiledShortcuts = {
  /** Active bindings by device signature. One signature has several only in exclusive scopes. */
  bySignature: ReadonlyMap<string, readonly ShortcutBinding[]>;
  byId: ReadonlyMap<ShortcutActionId, ShortcutBinding>;
  /** Assignments that cannot run on this device. Other assignments stay active. */
  problems: ReadonlyMap<ShortcutActionId, ShortcutProblem>;
};

const problemOf = (
  command: ShortcutCommandDefinition,
  combination: ShortcutCombination,
  platform: AppPlatform,
  shell: ShortcutShell,
): string | null => {
  const label = shortcutLabel(combination, platform);
  if (combination.key.kind === "logical" && !isShortcutKey(combination.key.key))
    return `${combination.key.key} is not a supported key.`;
  const resolved = resolveShortcutModifiers(combination, platform);
  const key = combination.key.kind === "logical" ? combination.key.key.toLowerCase() : "";
  const printable = combination.key.kind === "number-row" || Array.from(key).length === 1;
  if (platform !== "darwin" && resolved.ctrl && resolved.alt && printable)
    return `${label} types characters with AltGr on this keyboard.`;
  const keys = { key, ...resolved };
  if (shellReserved(keys, platform, shell))
    return `${label} is reserved by the ${shell === "browser" ? "browser" : "system"}.`;
  // The specification approves only the default keys of a command that runs while typing by default.
  const approvedException =
    command.allowInput &&
    command.defaultAllowInput &&
    sameShortcut(combination, command.defaultKeys[shell]);
  const reason = approvedException ? null : protectedInputReason(keys, platform);
  if (
    reason &&
    (command.allowInput ||
      reason === "native editing and selection" ||
      reason === "message submission")
  )
    return `${label} is reserved for ${reason}.`;
  return null;
};

/**
 * The active bindings of one device. An assignment that cannot run here, or that overlaps an
 * earlier coexisting binding, is inactive only on this device and reports its problem.
 */
export const compileShortcuts = (
  preferences: ShortcutPreferences,
  catalogue: readonly ShortcutCommandDefinition[],
  platform: AppPlatform,
  shell: ShortcutShell,
): CompiledShortcuts => {
  const bySignature = new Map<string, ShortcutBinding[]>();
  const byId = new Map<ShortcutActionId, ShortcutBinding>();
  const problems = new Map<ShortcutActionId, ShortcutProblem>();
  for (const entry of catalogue) {
    if (entry.unavailableReason) continue;
    const command = withWhen(entry, preferences);
    const combination = effectiveShortcut(command, preferences, shell);
    if (!combination) continue;
    const message = problemOf(command, combination, platform, shell);
    if (message) {
      problems.set(command.id, { commandId: command.id, message });
      continue;
    }
    const signature = shortcutSignature(combination, platform);
    const shared = bySignature.get(signature) ?? [];
    const conflict = shared.find((other) => scopesCanCoexist(other.command.scope, command.scope));
    if (conflict) {
      problems.set(command.id, {
        commandId: command.id,
        message: `${shortcutLabel(combination, platform)} is used by ${conflict.command.label}.`,
        conflict: conflict.command,
      });
      continue;
    }
    const binding = { command, combination, signature };
    shared.push(binding);
    bySignature.set(signature, shared);
    byId.set(command.id, binding);
  }
  return { bySignature, byId, problems };
};

/**
 * The problem that an assignment causes on a device: its own, or the problem of a command that
 * loses its keys to it. `conflict` then names that other command.
 */
export const problemOfCommand = (
  compiled: CompiledShortcuts,
  catalogue: readonly ShortcutCommandDefinition[],
  id: ShortcutActionId,
): ShortcutProblem | null => {
  const own = compiled.problems.get(id);
  if (own) return own;
  const lost = Array.from(compiled.problems.values()).find(
    (problem) => problem.conflict?.id === id,
  );
  if (!lost) return null;
  const loser = catalogue.find((command) => command.id === lost.commandId);
  return loser ? { commandId: id, message: lost.message, conflict: loser } : lost;
};

const DEVICES = [
  ["darwin", "macOS"],
  ["win32", "Windows"],
  ["linux", "Linux"],
] as const;
/**
 * The other devices where a command would be inactive, such as "on Windows" when it fails in both
 * apps there, or "in the browser on Linux".
 */
export const otherDeviceProblems = (
  preferences: ShortcutPreferences,
  catalogue: readonly ShortcutCommandDefinition[],
  id: ShortcutActionId,
  current: { platform: AppPlatform; shell: ShortcutShell },
): string[] =>
  DEVICES.flatMap(([platform, name]) => {
    const failing = (["electron", "browser"] as const).filter(
      (shell) =>
        (platform !== current.platform || shell !== current.shell) &&
        problemOfCommand(compileShortcuts(preferences, catalogue, platform, shell), catalogue, id),
    );
    if (failing.length === 2) return [`on ${name}`];
    return failing.map(
      (shell) => `in ${shell === "electron" ? "the desktop app" : "the browser"} on ${name}`,
    );
  });
