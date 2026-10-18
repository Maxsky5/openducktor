import type { AgentRole, NotificationKind, NotificationOccurrence } from "@openducktor/contracts";

const ROLE_LABELS = {
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
} satisfies Record<AgentRole, string>;

const WORKFLOW_COPY = {
  "workflow.spec_ready": { title: "Spec ready", body: "Task is ready for planning." },
  "workflow.ready_for_dev": {
    title: "Ready for dev",
    body: "The plan is ready. Start Builder to implement it.",
  },
  "workflow.in_progress": { title: "In progress", body: "Work has started on this task." },
  "workflow.blocked": {
    title: "Blocked",
    body: "This task needs your input before work can continue.",
  },
  "workflow.ai_review": {
    title: "Ready for QA",
    body: "The implementation is ready for QA review.",
  },
  "workflow.human_review": {
    title: "Review",
    body: "Review the changes and approve or request updates.",
  },
  "workflow.closed": { title: "Closed", body: "This task is closed." },
} satisfies Record<Extract<NotificationKind, `workflow.${string}`>, NotificationCopy>;

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

const isWorkflowKind = (kind: NotificationKind): kind is keyof typeof WORKFLOW_COPY =>
  kind.startsWith("workflow.");

export const buildNotificationCopy = (occurrence: NotificationOccurrence): NotificationCopy => {
  const workflowCopy = isWorkflowKind(occurrence.kind) ? WORKFLOW_COPY[occurrence.kind] : undefined;
  const agentLabel = occurrence.role ? ROLE_LABELS[occurrence.role] : occurrence.sessionLabel;
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
