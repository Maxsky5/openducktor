import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import {
  Activity,
  CircleAlert,
  ClipboardList,
  Clock,
  type LucideIcon,
  MessagesSquare,
} from "lucide-react";
import { formatElapsedAgo, formatElapsedShort } from "@/lib/relative-time";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";
import { statusLabel } from "@/lib/task-display";
import type {
  SessionNavigationAttentionReason,
  SessionNavigationEntry,
  SessionNavigationGroupId,
  SessionNavigationSourceIssue,
} from "@/state/read-models/session-navigation-read-model";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";

export const SESSION_GROUP_LABELS = {
  needs_you: "Needs you",
  running: "Running",
  recent: "Recent",
} satisfies Record<SessionNavigationGroupId, string>;

export const SESSION_GROUP_ICONS = {
  needs_you: CircleAlert,
  running: Activity,
  recent: Clock,
} satisfies Record<SessionNavigationGroupId, LucideIcon>;

export const sessionEntryIcon = (entry: SessionNavigationEntry): LucideIcon => {
  if (entry.target.kind === "task_session") {
    return AGENT_ROLE_ICONS[entry.target.role];
  }
  if (entry.target.kind === "workspace_session") return MessagesSquare;
  return ClipboardList;
};

const ISSUE_SOURCE_LABELS = {
  tasks: "Tasks could not load",
  task_sessions: "Task sessions could not load",
  workspace_sessions: "Workspace sessions could not load",
  live_status: "Live status is unavailable",
} satisfies Record<SessionNavigationSourceIssue["source"], string>;

export const sessionSourceIssueText = (issue: SessionNavigationSourceIssue): string =>
  `${issue.workspace.workspaceName}: ${ISSUE_SOURCE_LABELS[issue.source]}. ${issue.message}`;

export const ATTENTION_REASON_LABELS = {
  question: "Question",
  permission: "Permission",
  blocked: "Blocked",
} satisfies Record<SessionNavigationAttentionReason, string>;

/** A task target in the list is a blocked task without a saved session. */
export const sessionEntryTypeLabel = (entry: SessionNavigationEntry): string => {
  if (entry.target.kind === "task_session") return "Task session";
  if (entry.target.kind === "workspace_session") return "Workspace session";
  return "Blocked task";
};

export const sessionEntryRoleLabel = (entry: SessionNavigationEntry): string | null =>
  entry.target.kind === "task_session" ? AGENT_ROLE_LABELS[entry.target.role] : null;

export const sessionEntryRuntimeLabel = (entry: SessionNavigationEntry): string | null =>
  entry.runtimeKind === null ? null : RUNTIME_DESCRIPTORS_BY_KIND[entry.runtimeKind].label;

export const sessionEntryAttentionText = (entry: SessionNavigationEntry): string =>
  entry.attention.map((reason) => ATTENTION_REASON_LABELS[reason]).join(", ");

/** Live state for the floating card and accessible names. */
export const sessionEntryStatusText = (entry: SessionNavigationEntry): string => {
  if (entry.attention.length > 0) return `Needs you: ${sessionEntryAttentionText(entry)}`;
  if (entry.status.kind === "running") return "Running";
  if (entry.status.kind === "checking") return "Checking status";
  if (entry.status.kind === "unavailable") return `Status unavailable: ${entry.status.reason}`;
  return entry.status.failed ? "Last run failed" : "Idle";
};

export const sessionEntryTimeText = (entry: SessionNavigationEntry, now: number): string | null => {
  if (entry.time.kind === "activity") return `Active ${formatElapsedAgo(now - entry.time.at)}`;
  if (entry.time.kind === "none") return null;
  const issue = entry.time.activityTimeIssue ? ` ${entry.time.activityTimeIssue}` : "";
  return `Started ${formatElapsedAgo(now - entry.time.at)}. Latest activity time is unknown.${issue}`;
};

export const sessionEntryShortTime = (entry: SessionNavigationEntry, now: number): string | null =>
  entry.time.kind === "none" ? null : formatElapsedShort(now - entry.time.at);

export const sessionEntryAccessibleName = (entry: SessionNavigationEntry): string => {
  const role = sessionEntryRoleLabel(entry);
  const parts = [
    entry.title,
    role ? `${role} ${sessionEntryTypeLabel(entry)}` : sessionEntryTypeLabel(entry),
    entry.workspace.workspaceName,
    sessionEntryStatusText(entry),
  ];
  const runtime = sessionEntryRuntimeLabel(entry);
  if (entry.context.kind === "task")
    parts.push(`Task status: ${statusLabel(entry.context.task.status)}`);
  if (runtime) parts.push(`${runtime} runtime`);
  if (entry.fault) parts.push(`Observation fault: ${entry.fault}`);
  return parts.join(", ");
};
