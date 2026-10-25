import { SESSION_MENU_LABELS } from "@openducktor/frontend-core/workspace-sessions/workspace-session-menu";
import { titleCase } from "@/features/workflow/start-session/start-form-model";
import {
  SESSION_GROUP_LABELS,
  sessionEntryAccessibleName,
  sessionEntryRoleLabel,
  visibleSessionNavigationGroups,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-entry-labels";
import {
  type SessionEntryDotTone,
  type SessionEntryIconTone,
  type SessionEntryTitleTone,
  sessionEntryDotTone,
  sessionEntryIconTone,
  sessionEntryLocation,
  sessionEntryTitleTone,
} from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type {
  SessionNavigationEntry,
  SessionNavigationGroupId,
  SessionNavigationModel,
  SessionNavigationSourceIssue,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { type SessionRouteParams, sessionParams } from "@/navigation/routes";
import type { desktopColors } from "@/theme/desktop-colors";
import type { ActionMenuItem } from "@/ui/action-menu";

/** The name of a desktop theme color, as `theme.desktop` holds it. */
export type DesktopColorName = keyof (typeof desktopColors)["light"];

/** What the Sessions screen shows instead of its list, or `list`. */
export type SessionsScreenState =
  | "host_unavailable"
  | "loading"
  | "no_workspace"
  | "no_sessions"
  | "list";

/**
 * The state of the Sessions screen. The connection state explains an empty list while the host
 * is unavailable. A list that has entries or source issues shows them.
 */
export const sessionsScreenState = ({
  hostUnavailable,
  workspacesLoading,
  workspaceCount,
  model,
}: {
  hostUnavailable: boolean;
  workspacesLoading: boolean;
  workspaceCount: number;
  model: Pick<SessionNavigationModel, "entryCount" | "isLoading" | "issues">;
}): SessionsScreenState => {
  const empty = model.entryCount === 0;
  if (hostUnavailable && (workspaceCount === 0 || empty)) return "host_unavailable";
  if (workspacesLoading || (empty && model.isLoading && model.issues.length === 0)) {
    return "loading";
  }
  if (workspaceCount === 0) return "no_workspace";
  return empty && model.issues.length === 0 ? "no_sessions" : "list";
};

/** One FlashList item. Group headers are items, so one list recycles every row. */
export type SessionListItem =
  | { type: "issue"; key: string; issue: SessionNavigationSourceIssue }
  | {
      type: "header";
      key: string;
      groupId: SessionNavigationGroupId;
      label: string;
      count: number;
      collapsed: boolean;
    }
  | {
      type: "entry";
      key: string;
      groupId: SessionNavigationGroupId;
      entry: SessionNavigationEntry;
    };

const searchText = (entry: SessionNavigationEntry): string => {
  const parts = [entry.title, entry.workspace.workspaceName, sessionEntryRoleLabel(entry) ?? ""];
  if (entry.context.kind === "task") parts.push(entry.context.task.id);
  else parts.push(entry.context.session.executionTarget.workingDirectory);
  return parts.join(" ").toLowerCase();
};

/** True when the entry title, workspace, role, task ID, or chat folder holds the search. */
export const sessionMatchesQuery = (entry: SessionNavigationEntry, query: string): boolean => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(entry);
  return words.every((word) => text.includes(word));
};

/**
 * Flattens the navigation model into list items, as the desktop session list: Needs you and
 * Running always, Recent when it has sessions. A collapsed group keeps its header. A search shows
 * only the groups with matches.
 */
export const buildSessionListItems = (
  model: SessionNavigationModel,
  options: { collapsed: ReadonlySet<SessionNavigationGroupId>; query: string },
): SessionListItem[] => {
  const searching = options.query.trim().length > 0;
  const items: SessionListItem[] = model.issues.map((issue) => ({
    type: "issue",
    key: `issue:${issue.workspace.workspaceId}:${issue.source}`,
    issue,
  }));
  for (const group of visibleSessionNavigationGroups(model.groups)) {
    const entries = searching
      ? group.entries.filter((entry) => sessionMatchesQuery(entry, options.query))
      : group.entries;
    if (searching && entries.length === 0) continue;
    const collapsed = options.collapsed.has(group.id);
    items.push({
      type: "header",
      key: `header:${group.id}`,
      groupId: group.id,
      label: SESSION_GROUP_LABELS[group.id],
      count: entries.length,
      collapsed,
    });
    if (collapsed) continue;
    for (const entry of entries) {
      items.push({ type: "entry", key: entry.key, groupId: group.id, entry });
    }
  }
  return items;
};

/** The number that the Sessions tab badge shows. */
export const sessionsNeedsYouCount = (model: SessionNavigationModel): number =>
  model.groups.find((group) => group.id === "needs_you")?.entries.length ?? 0;

export type SessionDestination =
  | { kind: "session"; params: SessionRouteParams }
  | { kind: "task"; workspaceId: string; taskId: string }
  /** A chat whose runtime session has not started has no conversation to open. */
  | { kind: "not_started" };

const hasPendingInput = (entry: SessionNavigationEntry): boolean =>
  entry.attention.includes("question") || entry.attention.includes("permission");

const sessionDestination = (
  entry: SessionNavigationEntry,
  params: SessionRouteParams,
): SessionDestination => {
  if (!hasPendingInput(entry)) return { kind: "session", params };
  const focused: SessionRouteParams = { ...params, focus: "pending-input" };
  return { kind: "session", params: focused };
};

/**
 * Where a row opens. A session with pending input opens at that input. A Blocked task opens its
 * latest session, which the model already chose as the row target, or its task details when it
 * has no session.
 */
export const sessionEntryDestination = (entry: SessionNavigationEntry): SessionDestination => {
  const { target } = entry;
  if (target.kind === "task") {
    return { kind: "task", workspaceId: target.workspaceId, taskId: target.taskId };
  }
  if (target.kind === "task_session") {
    return sessionDestination(entry, {
      ...sessionParams(target.workspaceId, target.identity),
      title: entry.title,
      task: "1",
    });
  }
  const identity =
    entry.context.kind === "workspace" ? workspaceSessionIdentity(entry.context.session) : null;
  if (!identity) return { kind: "not_started" };
  return sessionDestination(entry, {
    ...sessionParams(target.workspaceId, identity),
    title: entry.title,
  });
};

/** What a screen reader hears for a row: its name, its active commands, and whether it is read or starts. */
export const sessionRowAccessibleLabel = (
  entry: SessionNavigationEntry,
  { commandCount, unread, starting }: { commandCount: number; unread: boolean; starting: boolean },
): string => {
  const parts = [sessionEntryAccessibleName(entry)];
  if (commandCount > 0) {
    parts.push(`${commandCount} active ${commandCount === 1 ? "command" : "commands"}`);
  }
  if (unread) parts.push("Unread");
  if (starting) parts.push("Starting");
  return parts.join(", ");
};

/** The surface of a row, as the desktop session row: warning, running, or plain. */
export type SessionRowSurface = "attention" | "running" | "plain";

export const sessionRowSurface = (entry: SessionNavigationEntry): SessionRowSurface => {
  if (entry.attention.length > 0) return "attention";
  if (entry.status.kind === "running") return "running";
  return "plain";
};

/**
 * The desktop workflow icon colors (`AGENT_WORKFLOW_TONE_ICON_CLASSES`), and the muted sidebar
 * color for a row without a workflow state.
 */
const ICON_COLORS = {
  in_progress: "infoMuted",
  done: "successIcon",
  available: "foreground",
  optional: "foreground",
  rejected: "rejectedMuted",
  waiting_input: "warningMuted",
  failed: "destructiveMuted",
  blocked: "mutedForeground",
  muted: "sidebarMutedForeground",
} as const satisfies Record<SessionEntryIconTone, DesktopColorName>;

const TITLE_COLORS = {
  attention: "warningMuted",
  read: "sidebarReadForeground",
  default: "foreground",
} as const satisfies Record<SessionEntryTitleTone, DesktopColorName>;

const DOT_COLORS = {
  input_unread: "statusInputUnread",
  input_read: "statusInputRead",
  running: "statusRunning",
  unread: "statusUnread",
  read: "statusRead",
} as const satisfies Record<SessionEntryDotTone, DesktopColorName>;

/** The color of the role or chat icon of a row, by the shared session row rules. */
export const sessionEntryIconColor = (entry: SessionNavigationEntry): DesktopColorName =>
  ICON_COLORS[sessionEntryIconTone(entry)];

/** The title color: warning when the session needs you, dimmed when it is read and settled. */
export const sessionEntryTitleColor = (
  entry: SessionNavigationEntry,
  unread: boolean,
): DesktopColorName => TITLE_COLORS[sessionEntryTitleTone(entry, unread)];

/** The status dot: running, or the read state in the input colors when the session needs you. */
export const sessionEntryDotColor = (
  entry: SessionNavigationEntry,
  unread: boolean,
): DesktopColorName => DOT_COLORS[sessionEntryDotTone(entry, unread)];

export type SessionMenuAction =
  | "toggle_read"
  | "rename"
  | "copy_working_directory"
  | "copy_external_session_id"
  | "archive";

/**
 * The same actions and words as the desktop session menu, in the title case of the mobile menus,
 * as the session header menu. Chats can also be renamed or archived.
 */
export const sessionMenuItems = (
  entry: SessionNavigationEntry,
  unread: boolean,
): (ActionMenuItem & { id: SessionMenuAction })[] => {
  const chat = entry.context.kind === "workspace";
  const location = sessionEntryLocation(entry);
  const items: (ActionMenuItem & { id: SessionMenuAction })[] = [
    {
      id: "toggle_read",
      title: titleCase(unread ? SESSION_MENU_LABELS.markRead : SESSION_MENU_LABELS.markUnread),
      icon: unread ? "mark-read" : "mark-unread",
    },
  ];
  if (chat) {
    items.push({ id: "rename", title: titleCase(SESSION_MENU_LABELS.rename), icon: "pencil" });
  }
  items.push(
    {
      id: "copy_working_directory",
      title: titleCase(SESSION_MENU_LABELS.copyWorkingDirectory),
      icon: "folder",
      disabled: location.workingDirectory === null,
    },
    {
      id: "copy_external_session_id",
      title: titleCase(SESSION_MENU_LABELS.copyExternalSessionId),
      icon: "copy",
      disabled: location.externalSessionId === null,
    },
  );
  if (chat) {
    items.push({
      id: "archive",
      title: titleCase(SESSION_MENU_LABELS.archive),
      icon: "archive",
    });
  }
  return items;
};

const SESSION_MENU_ACTIONS: readonly SessionMenuAction[] = [
  "toggle_read",
  "rename",
  "copy_working_directory",
  "copy_external_session_id",
  "archive",
];

/** The menu reports the item ID as a string. */
export const parseSessionMenuAction = (id: string): SessionMenuAction | null =>
  SESSION_MENU_ACTIONS.find((action) => action === id) ?? null;
