import { workflowRoleIcon } from "@openducktor/workflows";
import {
  Activity,
  CircleAlert,
  ClipboardList,
  Clock,
  type LucideIcon,
  MessageCirclePlus,
  MessagesSquare,
} from "lucide-react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import type {
  SessionNavigationEntry,
  SessionNavigationGroupId,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";

export const SESSION_GROUP_ICONS = {
  needs_you: CircleAlert,
  running: Activity,
  recent: Clock,
} satisfies Record<SessionNavigationGroupId, LucideIcon>;

export const sessionEntryIcon = (entry: SessionNavigationEntry): LucideIcon => {
  if (entry.target.kind === "task_session") {
    return roleIconForHint(
      entry.context.kind === "task"
        ? workflowRoleIcon(entry.context.task.taskWorkflow, entry.target.role)
        : undefined,
    );
  }
  if (entry.target.kind === "workspace_session_draft") {
    return entry.context.kind === "workspace_draft" && entry.context.isStarting
      ? MessagesSquare
      : MessageCirclePlus;
  }
  if (entry.target.kind === "workspace_session") return MessagesSquare;
  return ClipboardList;
};
