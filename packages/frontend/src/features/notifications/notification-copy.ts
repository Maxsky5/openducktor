import type { AgentRole, NotificationOccurrence } from "@openducktor/contracts";
import { NOTIFICATION_KIND_LABELS } from "./catalogue";

const ROLE_LABELS = {
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
} satisfies Record<AgentRole, string>;

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

export const buildNotificationCopy = (occurrence: NotificationOccurrence): NotificationCopy => {
  const eventLabel = NOTIFICATION_KIND_LABELS[occurrence.kind];
  const taskTitle = occurrence.task?.title
    ? `: ${toPlainNotificationText(occurrence.task.title)}`
    : "";
  const context = [toPlainNotificationText(occurrence.repositoryLabel)];
  if (occurrence.role) {
    context.push(ROLE_LABELS[occurrence.role]);
  } else if (occurrence.sessionLabel) {
    context.push(toPlainNotificationText(occurrence.sessionLabel));
  }

  return {
    title: `${eventLabel}${taskTitle}`.slice(0, 180),
    body: `${toPlainNotificationText(occurrence.status)}\n${context.join(" · ")}`.slice(0, 500),
  };
};
