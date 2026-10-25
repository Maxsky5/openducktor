import {
  BUILTIN_ROLE_LABELS,
  BUILTIN_WORKFLOW_NOTIFICATION_COPY,
  builtinRoleId,
} from "@openducktor/workflows";
import type { NotificationKind, NotificationOccurrence } from "@openducktor/contracts";

export type NotificationCopy = {
  title: string;
  body: string;
};

const toPlainNotificationText = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const isWorkflowKind = (
  kind: NotificationKind,
): kind is keyof typeof BUILTIN_WORKFLOW_NOTIFICATION_COPY =>
  Object.hasOwn(BUILTIN_WORKFLOW_NOTIFICATION_COPY, kind);

export const buildNotificationCopy = (occurrence: NotificationOccurrence): NotificationCopy => {
  const workflowCopy = isWorkflowKind(occurrence.kind)
    ? BUILTIN_WORKFLOW_NOTIFICATION_COPY[occurrence.kind]
    : undefined;
  const agentLabel = occurrence.role
    ? BUILTIN_ROLE_LABELS[builtinRoleId(occurrence.role)]
    : occurrence.sessionLabel;
  const label = workflowCopy?.title ?? toPlainNotificationText(agentLabel ?? "Agent");
  const taskTitle = toPlainNotificationText(occurrence.task?.title ?? "");
  const body =
    workflowCopy?.body ??
    (occurrence.kind === "agent.session_started" ? "Session started." : occurrence.status);

  return {
    title: `${label}${taskTitle ? ` - ${taskTitle}` : ""}`.slice(0, 180),
    body: toPlainNotificationText(body).slice(0, 500),
  };
};
