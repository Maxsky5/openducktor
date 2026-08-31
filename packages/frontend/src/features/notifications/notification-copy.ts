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

export const buildNotificationCopy = (occurrence: NotificationOccurrence): NotificationCopy => {
  const eventLabel = NOTIFICATION_KIND_LABELS[occurrence.kind];
  const taskIdentity = occurrence.task?.id ? ` - ${occurrence.task.id}` : "";
  const bodyParts = [occurrence.repositoryLabel];
  if (occurrence.task?.title) {
    bodyParts.push(occurrence.task.title);
  }
  if (occurrence.role) {
    bodyParts.push(ROLE_LABELS[occurrence.role]);
  }
  if (occurrence.sessionLabel) {
    bodyParts.push(occurrence.sessionLabel);
  }
  bodyParts.push(occurrence.status);

  return {
    title: `${eventLabel}${taskIdentity}`.slice(0, 180),
    body: bodyParts.join(" - ").slice(0, 500),
  };
};
