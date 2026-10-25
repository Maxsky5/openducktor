import {
  Activity,
  CircleAlert,
  ClipboardList,
  Clock,
  type LucideIcon,
  MessagesSquare,
} from "lucide-react";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";
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
    return AGENT_ROLE_ICONS[entry.target.role];
  }
  if (entry.target.kind === "workspace_session") return MessagesSquare;
  return ClipboardList;
};
