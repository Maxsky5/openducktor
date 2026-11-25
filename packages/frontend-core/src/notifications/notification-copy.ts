import type { NotificationOccurrence } from "@openducktor/contracts";
import { NOTIFICATION_KIND_LABELS } from "./catalogue";

export type NotificationCopy = {
  title: string;
  body: string;
};

/** A heading line ends as a sentence, so it does not run into the next line. */
const headingSentence = (_line: string, heading: string): string =>
  /[.!?:]$/.test(heading) ? heading : `${heading}.`;

const toPlainNotificationText = (text: string): string =>
  text
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, headingSentence)
    .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export const buildNotificationCopy = (occurrence: NotificationOccurrence): NotificationCopy => {
  if (occurrence.kind.startsWith("workflow.") && (!occurrence.workflow || !occurrence.copy))
    throw new Error(
      "Workflow notification is missing its committed presentation. Reconnect to an updated host.",
    );
  const workflowCopy = occurrence.copy;
  const label = toPlainNotificationText(
    workflowCopy?.title ??
      (occurrence.kind === "task.auto_close_blocked"
        ? NOTIFICATION_KIND_LABELS["task.auto_close_blocked"]
        : (occurrence.sessionLabel ?? occurrence.role ?? "Agent")),
  );
  const taskTitle = toPlainNotificationText(occurrence.task?.title ?? "");
  const body =
    workflowCopy?.body ??
    (occurrence.kind === "agent.session_started" ? "Session started." : occurrence.status);

  return {
    title: `${label}${taskTitle ? ` - ${taskTitle}` : ""}`.slice(0, 180),
    body: toPlainNotificationText(body).slice(0, 500),
  };
};
